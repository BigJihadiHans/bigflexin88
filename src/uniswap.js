// src/uniswap.js
const { ethers } = require('ethers');
const { sendFlashbotBundle } = require('./flashbots');

const provider = new ethers.JsonRpcProvider('https://rpc.beaverbuild.org'); // Use BeaverBuild RPC

async function sellAllTokens(wallets, tokenAddress) {
    const saleResults = [];
    const transactionPromises = [];

    for (let wallet of wallets) {
        try {
            const tokenContract = new ethers.Contract(tokenAddress, require('./ERC20_ABI.json'), provider);
            const tokenBalance = await tokenContract.balanceOf(wallet.address);

            if (tokenBalance.gt(0)) {
                const amountIn = tokenBalance;
                const saleMessage = `Selling ${amountIn.toString()} tokens from ${wallet.address}`;

                console.log(saleMessage);

                const saleResult = await sendFlashbotBundle(wallets, tokenAddress, amountIn);
                saleResults.push({ wallet: wallet.address, status: 'Success' });
            } else {
                saleResults.push({ wallet: wallet.address, status: 'No tokens to sell' });
            }
        } catch (error) {
            console.error(`Error for wallet ${wallet.address}: ${error.message}`);
            saleResults.push({ wallet: wallet.address, status: `Error: ${error.message}` });
        }
    }

    return saleResults;
}

module.exports = { sellAllTokens };