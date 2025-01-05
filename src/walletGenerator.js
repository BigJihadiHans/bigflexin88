const { Wallet } = require("ethers");

/**
 * Generates an array of Ethereum wallets.
 * @param {number} count - Number of wallets to generate.
 * @returns {Wallet[]} - Array of generated wallets.
 */
function generateWallets(count) {
    const wallets = [];
    for (let i = 0; i < count; i++) {
        wallets.push(Wallet.createRandom());
    }
    return wallets;
}

module.exports = { generateWallets };
