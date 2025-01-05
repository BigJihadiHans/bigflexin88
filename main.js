const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initializeProvider } = require('./src/bundlerLogic');
const { generateWalletsAndDeploy } = require('./src/walletGenerator');

// Debug logging to ensure the file is loaded only once
console.log('main.js loaded');

// Global reference to the main window to prevent it from being garbage collected
let mainWindow;

const createWindow = () => {
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Ensure preload.js is used for secure communication
            nodeIntegration: false, // Disable node integration for security
            contextIsolation: true, // Enable context isolation for improved security
        },
    });

    // Load the index.html of the app
    mainWindow.loadFile('index.html');

    // Open the DevTools if you need debugging (optional)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};

app.on('ready', async () => {
    try {
        // Initialize Ethereum provider
        const provider = await initializeProvider();
        console.log(`Ethereum provider initialized successfully with RPC URL: ${provider.connection.url}`);

        // Create the main application window
        createWindow();

        // Register IPC handlers safely
        if (!ipcMain._events['generate-wallets-and-deploy']) {
            ipcMain.handle('generate-wallets-and-deploy', async (event, { walletCount, tokenAddress }) => {
                try {
                    const result = await generateWalletsAndDeploy(walletCount, tokenAddress);
                    return `Wallets generated and contract deployed: ${result}`;
                } catch (error) {
                    console.error(error);
                    return `Error: ${error.message}`;
                }
            });
        } else {
            console.log('Handler for "generate-wallets-and-deploy" already registered');
        }
    } catch (error) {
        console.error(`Error initializing app: ${error.message}`);
        app.quit();
    }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
