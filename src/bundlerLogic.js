const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

// Network Constants
const BEAVER_RPC = 'https://rpc.beaverbuild.org/';
const PUBLIC_RPC = 'https://rpc.ankr.com/eth';

// Contract Constants
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// ABIs
const ROUTER_ABI = [
    'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
];

const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
    'function allPairs(uint) external view returns (address pair)'
];

const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)',
    'function allowance(address owner, address spender) external view returns (uint256)'
];

// Gas Settings
const GAS_SETTINGS = {
    maxFeePerGas: ethers.parseUnits('24', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('0.14', 'gwei'),
    gasLimits: {
        approve: 50000,
        addLiquidity: 200000,
        buy: 200000,
        transfer: 21000
    }
};

function parseNumberInput(input) {
    if (typeof input !== 'string') return input.toString();
    return input.replace(/,/g, '').replace(/\s/g, '');
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendBundle(transactions) {
    try {
        console.log('Preparing bundle for Beaver Build...');
        const response = await fetch(BEAVER_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_sendBundle',
                params: [{
                    txs: transactions,
                    blockNumber: '0x0'
                }]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(`Bundle Error: ${JSON.stringify(data.error)}`);
        return data.result;
    } catch (error) {
        console.error('Error sending bundle:', error);
        throw error;
    }
}

async function fundWallets(provider, fundingWallet, wallets, ethPerWallet) {
    console.log('\nPreparing funding transactions...');
    const fundingTxs = [];
    const nonce = await provider.getTransactionCount(fundingWallet.address);

    const cleanEthAmount = parseNumberInput(ethPerWallet);

    for (let i = 0; i < wallets.length; i++) {
        const tx = {
            to: wallets[i].address,
            value: ethers.parseEther(cleanEthAmount),
            nonce: nonce + i,
            gasLimit: GAS_SETTINGS.gasLimits.transfer,
            maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
            maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
            chainId: 1
        };

        const signedTx = await fundingWallet.signTransaction(tx);
        fundingTxs.push(signedTx);
        console.log(`Prepared funding for wallet ${i + 1}: ${wallets[i].address}`);
    }

    console.log('\nSending funding bundle...');
    const fundingResponse = await sendBundle(fundingTxs);
    console.log('Funding bundle hash:', fundingResponse.bundleHash);
    console.log('\nWaiting for funding transactions to confirm...');
    await sleep(5000);
}

async function prepareTransactions(
    provider,
    tokenAddress,
    devWallet,
    wallets,
    tokenAmount,
    ethForLiquidity,
    buyAmounts // Array of individual buy amounts
) {
    const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    const decimals = await token.decimals();
    console.log(`\nToken decimals: ${decimals}`);

    const cleanTokenAmount = parseNumberInput(tokenAmount);
    const cleanEthAmount = parseNumberInput(ethForLiquidity);

    console.log('\nParsed amounts:');
    console.log(`Token amount: ${cleanTokenAmount}`);
    console.log(`ETH amount: ${cleanEthAmount}`);
    console.log('Buy amounts:');
    buyAmounts.forEach((amount, index) => {
        console.log(`Wallet ${index + 1}: ${amount} ETH`);
    });

    const tokenAmountBN = ethers.parseUnits(cleanTokenAmount, decimals);
    const ethAmountBN = ethers.parseEther(cleanEthAmount);

    console.log('\nPreparing approval transaction...');
    const approveTx = {
        to: tokenAddress,
        data: token.interface.encodeFunctionData('approve', [UNISWAP_V2_ROUTER, tokenAmountBN]),
        nonce: await provider.getTransactionCount(devWallet.address),
        gasLimit: GAS_SETTINGS.gasLimits.approve,
        maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
        maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
        chainId: 1
    };

    console.log('Preparing LP addition transaction...');
    const addLiquidityTx = {
        to: UNISWAP_V2_ROUTER,
        value: ethAmountBN,
        data: router.interface.encodeFunctionData('addLiquidityETH', [
            tokenAddress,
            tokenAmountBN,
            tokenAmountBN,
            ethAmountBN,
            devWallet.address,
            Math.floor(Date.now() / 1000) + 1200
        ]),
        nonce: await provider.getTransactionCount(devWallet.address) + 1,
        gasLimit: GAS_SETTINGS.gasLimits.addLiquidity,
        maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
        maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
        chainId: 1
    };

    console.log('\nPreparing buy transactions...');
    const buyTxs = [];
    for (let i = 0; i < wallets.length; i++) {
        await sleep(100);

        const cleanBuyAmount = parseNumberInput(buyAmounts[i].toString());

        const tx = {
            to: UNISWAP_V2_ROUTER,
            value: ethers.parseEther(cleanBuyAmount),
            data: router.interface.encodeFunctionData('swapExactETHForTokens', [
                0,
                [WETH_ADDRESS, tokenAddress],
                wallets[i].address,
                Math.floor(Date.now() / 1000) + 1200
            ]),
            nonce: await provider.getTransactionCount(wallets[i].address),
            gasLimit: GAS_SETTINGS.gasLimits.buy,
            maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
            maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
            chainId: 1
        };

        const signedTx = await wallets[i].signTransaction(tx);
        buyTxs.push(signedTx);
        console.log(`Prepared buy transaction for wallet ${i + 1}: ${wallets[i].address} (${cleanBuyAmount} ETH)`);
    }

    const signedApproveTx = await devWallet.signTransaction(approveTx);
    const signedAddLiquidityTx = await devWallet.signTransaction(addLiquidityTx);

    return [signedApproveTx, signedAddLiquidityTx, ...buyTxs];
}

async function monitorBundle(provider, bundleHash, transactions, tokenAddress) {
    console.log('\nMonitoring bundle execution...');
    const startBlock = await provider.getBlockNumber();
    const confirmedTxs = new Set();
    let lpAdded = false;

    while (confirmedTxs.size < transactions.length) {
        const currentBlock = await provider.getBlockNumber();
        console.log(`\nChecking block ${currentBlock} (${currentBlock - startBlock} blocks since submission)`);

        for (const tx of transactions) {
            const hash = ethers.keccak256(tx);
            if (!confirmedTxs.has(hash)) {
                const receipt = await provider.getTransactionReceipt(hash);
                if (receipt) {
                    confirmedTxs.add(hash);
                    if (!lpAdded && receipt.to.toLowerCase() === UNISWAP_V2_ROUTER.toLowerCase()) {
                        lpAdded = true;
                        console.log('\n🎯 LP Addition confirmed!');
                    } else {
                        console.log('\n💰 Buy transaction confirmed!');
                    }
                    console.log(`Transaction: ${receipt.hash}`);
                    console.log(`Block: ${receipt.blockNumber}`);
                    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
                }
            }
        }

        if (confirmedTxs.size < transactions.length) {
            await sleep(2000);
        }
    }

    console.log('\n✅ All transactions confirmed!');
}

async function main() {
    try {
        console.log('Starting Bundler...');
        const provider = new ethers.JsonRpcProvider(PUBLIC_RPC);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const question = (query) => new Promise((resolve) => rl.question(query, resolve));

        const walletCount = parseInt(await question('Number of wallets to generate? '), 10);
        if (isNaN(walletCount) || walletCount <= 0) {
            throw new Error('Please enter a valid number greater than 0');
        }

        console.log('\nGenerating wallets...');
        const wallets = [];
        for (let i = 0; i < walletCount; i++) {
            const wallet = ethers.Wallet.createRandom().connect(provider);
            wallets.push(wallet);
            console.log(`Generated wallet ${i + 1}: ${wallet.address}`);
        }

        const walletData = wallets.map(wallet => ({
            address: wallet.address,
            privateKey: wallet.privateKey,
        }));

        fs.writeFileSync('./generated_wallets.json', JSON.stringify(walletData, null, 2));
        console.log('\nWallets saved to generated_wallets.json');

        const fundingKey = await question('\nEnter funding wallet private key: ');
        const fundingWallet = new ethers.Wallet(fundingKey, provider);
        console.log(`Funding wallet: ${fundingWallet.address}`);

        const ethPerWallet = await question('ETH amount for each wallet: ');
        await fundWallets(provider, fundingWallet, wallets, ethPerWallet);

        const devKey = await question('\nEnter dev wallet private key (holding tokens): ');
        const devWallet = new ethers.Wallet(devKey, provider);
        console.log(`Dev wallet: ${devWallet.address}`);

        const tokenAddress = await question('\nEnter token address: ');
        if (!ethers.isAddress(tokenAddress)) {
            throw new Error('Invalid token address');
        }

        const tokenAmount = await question('\nToken amount for liquidity: ');
        const ethForLiquidity = await question('ETH amount for liquidity: ');

        // Collect individual buy amounts
        const buyAmounts = [];
        for (let i = 0; i < wallets.length; i++) {
            const buyAmount = await question(`ETH amount for wallet ${i + 1} buy: `);
            buyAmounts.push(buyAmount);
        }

        console.log('\nPreparing all transactions...');
        const allTxs = await prepareTransactions(
            provider,
            tokenAddress,
            devWallet,
            wallets,
            tokenAmount,
            ethForLiquidity,
            buyAmounts
        );

        await question('\nPress Enter to send bundle...');

        console.log('Sending bundle...');
        const bundleResponse = await sendBundle(allTxs);
        console.log('Bundle hash:', bundleResponse.bundleHash);

        await monitorBundle(provider, bundleResponse.bundleHash, allTxs, tokenAddress);

        rl.close();
    } catch (error) {
        console.error('\nError:', error);
        process.exit(1);
    }
}

console.log('Initializing Bundler...');
main().catch(console.error);
