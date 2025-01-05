// src/flashbots.js
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const { ethers } = require('ethers');

// Setup Flashbots Provider using BeaverBuild RPC
const BEAVERBUILD_RPC_URL = 'https://rpc.beaverbuild.org';
const provider = new ethers.JsonRpcProvider(BEAVERBUILD_RPC_URL);

// Function to bundle transactions using Flashbots
async function sendFlashbotBundle(wallets, tokenAddress, amountIn) {
    try {
        const wallet = wallets[0]; // You can pick one wallet from the array to submit a Flashbots bundle
        const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet, 'https://relay.flashbots.net', 'mainnet');

        const routerAddress = '0x5C69bEe701ef814a2B6a3EDD4B3a1C2e6C9B56f3'; // Uniswap V2 Router
        const routerContract = new ethers.Contract(routerAddress, require('@uniswap/v2-core/build/UniswapV2Router02.json').abi);

        const tokenContract = new ethers.Contract(tokenAddress, require('./ERC20_ABI.json'), provider);
        const approveTx = await tokenContract.populateTransaction.approve(routerAddress, amountIn);

        const swapTx = await routerContract.populateTransaction.swapExactTokensForETH(
            amountIn,
            0, // Amount out min (can be adjusted for slippage)
            [tokenAddress, ethers.constants.AddressZero],
            wallet.address,
            Math.floor(Date.now() / 1000) + 60 * 10 // Deadline 10 mins
        );

        const signedBundle = await flashbotsProvider.signBundle([
            { signer: wallet, transaction: approveTx },
            { signer: wallet, transaction: swapTx },
        ]);

        const bundleSubmission = await flashbotsProvider.sendBundle(signedBundle, provider.getBlockNumber() + 1);
        console.log(`Bundle submitted with status: ${bundleSubmission}`);

        return 'Bundle successfully sent!';
    } catch (error) {
        console.error(`Error sending Flashbots bundle: ${error.message}`);
        throw new Error('Flashbots bundle failed');
    }
}

module.exports = { sendFlashbotBundle };