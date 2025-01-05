const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

// Constants - Separate RPCs for different operations
const BEAVER_RPC = 'https://rpc.beaverbuild.org/';
const PUBLIC_RPC = 'https://rpc.ankr.com/eth';  // Public RPC for reading state
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const ROUTER_ABI = [
    'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)'
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)'
];

// Optimized gas settings for Ethereum mainnet
const GAS_SETTINGS = {
    maxFeePerGas: ethers.parseUnits('15', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('0.3', 'gwei'),
    gasLimits: {
        approve: 50000,
        addLiquidity: 200000,
        buy: 150000,
        transfer: 21000
    }
};

function parseNumberInput(input) {
    if (typeof input !== 'string') return input.toString();
    return input.replace(/,/g, '').replace(/\s/g, '');
}

// Function to send bundles through Beaver Build
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

async function setupWallets() {
    // Use public RPC for reading state
    const provider = new ethers.JsonRpcProvider(PUBLIC_RPC);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
        console.log('\n=== Wallet Generation ===');
        const walletCount = parseInt(await question('Number of wallets to generate? '), 10);
        if (isNaN(walletCount) || walletCount <= 0) {
            throw new Error('Please enter a valid number greater than 0');
        }

        console.log('\nGenerating wallets...');
        const wallets = Array(walletCount).fill(0).map(() => {
            const wallet = ethers.Wallet.createRandom().connect(provider);
            return wallet;
        });

        wallets.forEach((wallet, i) => console.log(`Wallet ${i + 1}: ${wallet.address}`));

        const walletData = wallets.map(wallet => ({
            address: wallet.address,
            privateKey: wallet.privateKey,
        }));
        fs.writeFileSync('./generated_wallets.json', JSON.stringify(walletData, null, 2));
        console.log('\nWallets saved to generated_wallets.json');

        console.log('\n=== Funding Setup ===');
        const fundingKey = await question('Enter funding wallet private key: ');
        const cleanFundingKey = fundingKey.startsWith('0x') ? fundingKey : `0x${fundingKey}`;
        const fundingWallet = new ethers.Wallet(cleanFundingKey, provider);
        console.log(`\nFunding wallet: ${fundingWallet.address}`);

        const balance = await provider.getBalance(fundingWallet.address);
        console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

        const ethPerWallet = parseFloat(await question('\nETH amount for each wallet: '));
        const totalNeeded = ethers.parseEther((ethPerWallet * walletCount).toString());

        if (balance < totalNeeded) {
            throw new Error(`Insufficient balance. Have: ${ethers.formatEther(balance)} ETH, Need: ${ethers.formatEther(totalNeeded)} ETH`);
        }

        console.log('\nPreparing funding transactions...');
        const fundingTxs = [];
        const nonce = await provider.getTransactionCount(fundingWallet.address);

        for (let i = 0; i < wallets.length; i++) {
            const tx = {
                to: wallets[i].address,
                value: ethers.parseEther(ethPerWallet.toString()),
                nonce: nonce + i,
                gasLimit: GAS_SETTINGS.gasLimits.transfer,
                maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
                maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
                chainId: 1
            };

            const signedTx = await fundingWallet.signTransaction(tx);
            fundingTxs.push(signedTx);
            console.log(`Prepared funding for wallet ${i + 1}`);
        }

        console.log('\nSending funding bundle...');
        const fundingResponse = await sendBundle(fundingTxs);
        console.log('Funding bundle hash:', fundingResponse.bundleHash);

        console.log('\n=== Token Setup ===');
        const devKey = await question('Enter dev wallet private key (wallet holding tokens): ');
        const cleanDevKey = devKey.startsWith('0x') ? devKey : `0x${devKey}`;
        const devWallet = new ethers.Wallet(cleanDevKey, provider);
        console.log(`Dev wallet: ${devWallet.address}`);

        return { wallets, devWallet, provider, rl, question };
    } catch (error) {
        console.error('\nSetup Error:', error.message);
        rl.close();
        throw error;
    }
}

async function prepareBundleTransactions(
    tokenAddress,
    wallets,
    devWallet,
    provider,
    tokenAmountForLiquidity,
    ethForLiquidity,
    ethPerBuy
) {
    const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    const decimals = await token.decimals();
    console.log(`\nToken decimals: ${decimals}`);

    const cleanTokenAmount = parseNumberInput(tokenAmountForLiquidity);
    const cleanEthAmount = parseNumberInput(ethForLiquidity);

    const tokenAmountBN = ethers.parseUnits(cleanTokenAmount, decimals);
    const ethAmountBN = ethers.parseEther(cleanEthAmount);

    const devBalance = await token.balanceOf(devWallet.address);
    console.log(`\nDev wallet token balance: ${ethers.formatUnits(devBalance, decimals)}`);

    if (devBalance < tokenAmountBN) {
        throw new Error(`Insufficient token balance. Have: ${ethers.formatUnits(devBalance, decimals)}, Need: ${cleanTokenAmount}`);
    }

    const approveTx = {
        to: tokenAddress,
        data: new ethers.Interface(ERC20_ABI).encodeFunctionData('approve', [
            UNISWAP_V2_ROUTER,
            tokenAmountBN
        ]),
        nonce: await provider.getTransactionCount(devWallet.address),
        gasLimit: GAS_SETTINGS.gasLimits.approve,
        maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
        maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
        chainId: 1
    };

    const addLiquidityTx = {
        to: UNISWAP_V2_ROUTER,
        value: ethAmountBN,
        data: router.interface.encodeFunctionData('addLiquidityETH', [
            tokenAddress,
            tokenAmountBN,
            tokenAmountBN,
            ethAmountBN,
            devWallet.address,
            Math.floor(Date.now() / 1000) + 60 * 20
        ]),
        nonce: await provider.getTransactionCount(devWallet.address) + 1,
        gasLimit: GAS_SETTINGS.gasLimits.addLiquidity,
        maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
        maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
        chainId: 1
    };

    const signedApproveTx = await devWallet.signTransaction(approveTx);
    const signedAddLiquidityTx = await devWallet.signTransaction(addLiquidityTx);

    const buyTxs = [];
    for (const wallet of wallets) {
        const tx = {
            to: UNISWAP_V2_ROUTER,
            value: ethers.parseEther(ethPerBuy.toString()),
            data: router.interface.encodeFunctionData('swapExactETHForTokens', [
                0,
                [WETH_ADDRESS, tokenAddress],
                wallet.address,
                Math.floor(Date.now() / 1000) + 60 * 20
            ]),
            nonce: await provider.getTransactionCount(wallet.address),
            gasLimit: GAS_SETTINGS.gasLimits.buy,
            maxFeePerGas: GAS_SETTINGS.maxFeePerGas,
            maxPriorityFeePerGas: GAS_SETTINGS.maxPriorityFeePerGas,
            chainId: 1
        };

        const signedTx = await wallet.signTransaction(tx);
        buyTxs.push(signedTx);
    }

    return [signedApproveTx, signedAddLiquidityTx, ...buyTxs];
}

async function main() {
    try {
        console.log('Starting Block 0 Bundler...');

        const { wallets, devWallet, provider, rl, question } = await setupWallets();

        const tokenAddress = await question('\nEnter token contract address: ');
        if (!ethers.isAddress(tokenAddress)) {
            throw new Error('Invalid token address');
        }

        const tokenAmountForLiquidity = await question('\nEnter amount of tokens to add to liquidity (can include commas): ');
        const ethForLiquidity = await question('\nEnter amount of ETH to add to liquidity: ');
        const ethPerBuy = parseFloat(await question('\nETH amount per buy transaction: '));

        if (isNaN(ethPerBuy) || ethPerBuy <= 0) {
            throw new Error('Invalid ETH amount for buys');
        }

        console.log('\nPreparing bundle transactions...');
        const allTxs = await prepareBundleTransactions(
            tokenAddress,
            wallets,
            devWallet,
            provider,
            tokenAmountForLiquidity,
            ethForLiquidity,
            ethPerBuy
        );

        console.log('\nAll transactions prepared. Ready to send bundle.');
        await question('\nPress Enter to send bundle...');

        console.log('Sending bundle to Beaver Build...');
        const bundleResponse = await sendBundle(allTxs);
        console.log('\nBundle sent successfully!');
        console.log('Bundle Hash:', bundleResponse.bundleHash);

        console.log('\nSummary:');
        console.log('Token Address:', tokenAddress);
        console.log('LP Token Amount:', tokenAmountForLiquidity);
        console.log('LP ETH Amount:', ethForLiquidity);
        console.log('Number of buy transactions:', wallets.length);
        console.log('ETH per buy:', ethPerBuy);
        console.log('Bundle Hash:', bundleResponse.bundleHash);

        rl.close();

    } catch (error) {
        console.error('\nError:', error.message);
        process.exit(1);
    }
}

console.log('Initializing Block 0 Bundler...');
main().catch(console.error);