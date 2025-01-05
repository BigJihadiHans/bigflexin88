const readline = require('readline');
const { initializeProvider, generateWalletsAndDeploy, sellAllTokens } = require('./bundlerLogic');

// Start the Ethereum provider
initializeProvider();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const mainMenu = () => {
    console.log('\n=== EVM Bundler ===');
    console.log('1. Generate Wallets and Deploy ERC-20');
    console.log('2. Sell All Tokens');
    console.log('3. Exit');
    rl.question('Choose an option: ', async (option) => {
        switch (option) {
            case '1':
                await generateWalletsMenu();
                break;
            case '2':
                await sellTokensMenu();
                break;
            case '3':
                console.log('Exiting...');
                rl.close();
                process.exit(0);
            default:
                console.log('Invalid option. Try again.');
                mainMenu();
        }
    });
};

const generateWalletsMenu = async () => {
    rl.question('Enter the number of wallets to generate: ', (walletCount) => {
        rl.question('Enter token name: ', (tokenName) => {
            rl.question('Enter token symbol: ', (tokenSymbol) => {
                rl.question('Enter initial supply: ', async (tokenSupply) => {
                    try {
                        const result = await generateWalletsAndDeploy(
                            parseInt(walletCount),
                            tokenName,
                            tokenSymbol,
                            tokenSupply
                        );
                        console.log(result);
                        mainMenu();
                    } catch (error) {
                        console.error(`Error: ${error.message}`);
                        mainMenu();
                    }
                });
            });
        });
    });
};

const sellTokensMenu = async () => {
    try {
        const result = await sellAllTokens();
        console.log(result);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
    mainMenu();
};

// Start the app
mainMenu();
