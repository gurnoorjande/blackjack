

import cors from 'cors';
import express from 'express';
import net from 'net';
import bodyParser from 'body-parser';

// Configuration constants
const TIMEOUT_SECONDS = 20; // Inactivity timeout for clients
const GAME_SERVER_PORT = parseInt(process.argv[2] ?? 2000);

// In-memory storage for client connections
const clientSockets = {};

// Express API setup
const api = express();
api.use(cors());
api.use(bodyParser.json());

/**
 * Establishes an initial connection to the game server.
 * Returns a promise that resolves with the socket and the initial data.
 */
function establishConnection() {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.connect(GAME_SERVER_PORT, 'localhost', () => {
            console.log('Connected to game server.');
        });

        socket.on('data', (data) => {
            resolve([socket, data.toString()]);
        });

        socket.on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Sets up event handlers for a client's socket connection.
 * @param {net.Socket} socket - The client socket.
 * @param {string} clientId - The unique identifier for the client.
 */
function handleSocketEvents(socket, clientId) {
    socket.on('data', (data) => {
        if (clientSockets[clientId]) {
            clientSockets[clientId].data = data.toString();
        }
    });

    socket.on('close', () => {
        console.log('Game server closed connection.');
        // Notify all clients that the server has closed
        Object.values(clientSockets).forEach((client) => {
            client.data = { status: 3 };
        });
    });

    socket.on('error', (error) => {
        console.error(`Socket error for client ${clientId}: ${error}`);
    });
}

/**
 * API endpoint to initiate a new client connection.
 * Responds with a unique client ID after establishing a socket connection.
 */
api.get('/connect', (req, res) => {
    console.log('New connection request received.');
    establishConnection()
        .then(([socket, initialData]) => {
            const { playerID, gameState } = JSON.parse(initialData);
            handleSocketEvents(socket, playerID);
            clientSockets[playerID] = {
                socket,
                data: gameState,
                timestamp: Date.now()
            };
            res.json({ id: playerID });
        })
        .catch((error) => {
            console.error(error);
            res.status(500).send('Connection error.');
        });
});

/**
 * API endpoint for clients to poll for game state updates.
 */
api.get('/update/:id', (req, res) => {
    const clientId = req.params.id;
    if (clientSockets[clientId]) {
        clientSockets[clientId].timestamp = Date.now();
        res.json(clientSockets[clientId].data || {});
    } else {
        res.status(404).send('Client not found.');
    }
});

/**
 * API endpoint for clients to send game actions (e.g., betting, hitting, standing).
 */
api.post('/action/:id', (req, res) => {
    const clientId = req.params.id;
    if (clientSockets[clientId]) {
        clientSockets[clientId].socket.write(Buffer.from(JSON.stringify(req.body)));
        res.sendStatus(200);
    } else {
        res.status(404).send('Client not found.');
    }
});

// Start the API server on port 3000
api.listen(3000, () => {
    console.log('API server listening on port 3000.');
    console.log(`Routing to game server on port ${GAME_SERVER_PORT}.`);
});

/**
 * Periodically removes clients that have not polled within the timeout period.
 */
function pruneInactiveClients() {
    const now = Date.now();
    for (const clientId in clientSockets) {
        if (clientSockets[clientId].timestamp < now - TIMEOUT_SECONDS * 1000) {
            clientSockets[clientId].socket.end();
            console.log(`Disconnected client ${clientId}.`);
            delete clientSockets[clientId];
        }
    }
}

// Check for inactive clients every 5 seconds
setInterval(pruneInactiveClients, 5000);
