const { ethers } = require('ethers');

console.log('ethers object:', ethers); // Should show the full ethers object
console.log('ethers.providers:', ethers.providers); // Should contain JsonRpcProvider
console.log('JsonRpcProvider:', ethers.providers?.JsonRpcProvider); // Check if JsonRpcProvider exists
