const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (for simplicity)
const rooms = new Map();
const players = new Map();

// Helper functions
function createDeck() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  
  // Shuffle deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

function dealCards(deck, numPlayers) {
  const hands = [];
  for (let i = 0; i < numPlayers; i++) {
    hands.push([deck.pop(), deck.pop()]);
  }
  return hands;
}

function createInitialGameState(settings, playerIds) {
  const deck = createDeck();
  const hands = dealCards(deck, playerIds.length);
  
  const players = playerIds.map((id, index) => ({
    id,
    chips: settings.startingChips,
    bet: 0,
    folded: false,
    allIn: false,
    cards: hands[index],
    position: index
  }));
  
  return {
    players,
    pot: 0,
    currentBet: 0,
    currentPlayerIndex: 0,
    phase: 'preflop',
    communityCards: [],
    deck: deck.slice(0, -playerIds.length * 2),
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    handNumber: 1
  };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create room
app.post('/api/rooms/create', (req, res) => {
  try {
    const { hostName, settings } = req.body;
    
    if (!hostName || !settings) {
      return res.status(400).json({ error: 'Missing hostName or settings' });
    }
    
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hostId = uuidv4();
    
    const room = {
      code: roomCode,
      hostId,
      settings,
      players: [{ id: hostId, name: hostName, isHost: true }],
      gameState: null,
      gameStarted: false,
      createdAt: new Date().toISOString()
    };
    
    rooms.set(roomCode, room);
    players.set(hostId, { roomCode, name: hostName });
    
    console.log(`Room created: ${roomCode} by ${hostName}`);
    
    res.json({
      roomCode,
      playerId: hostId,
      isHost: true,
      game: {
        roomCode,
        players: room.players,
        settings,
        gameStarted: false,
        gameState: null
      }
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join room
app.post('/api/rooms/join', (req, res) => {
  try {
    const { roomCode, playerName } = req.body;
    
    if (!roomCode || !playerName) {
      return res.status(400).json({ error: 'Missing roomCode or playerName' });
    }
    
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Game already started' });
    }
    
    if (room.players.length >= room.settings.maxPlayers) {
      return res.status(400).json({ error: 'Room is full' });
    }
    
    const playerId = uuidv4();
    const player = { id: playerId, name: playerName, isHost: false };
    
    room.players.push(player);
    players.set(playerId, { roomCode: room.code, name: playerName });
    
    console.log(`Player ${playerName} joined room ${roomCode}`);
    
    res.json({
      roomCode: room.code,
      playerId,
      isHost: false,
      game: {
        roomCode: room.code,
        players: room.players,
        settings: room.settings,
        gameStarted: room.gameStarted,
        gameState: room.gameState
      }
    });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Update settings
app.post('/api/rooms/settings', (req, res) => {
  try {
    const { roomCode, hostId, settings } = req.body;
    
    const room = rooms.get(roomCode);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.hostId !== hostId) {
      return res.status(403).json({ error: 'Only host can update settings' });
    }
    
    room.settings = { ...room.settings, ...settings };
    
    console.log(`Settings updated for room ${roomCode}`);
    
    res.json({
      game: {
        roomCode: room.code,
        players: room.players,
        settings: room.settings,
        gameStarted: room.gameStarted,
        gameState: room.gameState
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Start new hand
app.post('/api/rooms/new-hand', (req, res) => {
  try {
    const { roomCode, hostId } = req.body;
    
    const room = rooms.get(roomCode);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.hostId !== hostId) {
      return res.status(403).json({ error: 'Only host can start new hand' });
    }
    
    if (room.players.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to start' });
    }
    
    const playerIds = room.players.map(p => p.id);
    room.gameState = createInitialGameState(room.settings, playerIds);
    room.gameStarted = true;
    
    console.log(`New hand started for room ${roomCode}`);
    
    res.json({
      game: {
        roomCode: room.code,
        players: room.players,
        settings: room.settings,
        gameStarted: room.gameStarted,
        gameState: room.gameState
      }
    });
  } catch (error) {
    console.error('Start new hand error:', error);
    res.status(500).json({ error: 'Failed to start new hand' });
  }
});

// Betting action
app.post('/api/rooms/action', (req, res) => {
  try {
    const { roomCode, playerId, action, amount } = req.body;
    
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) {
      return res.status(404).json({ error: 'Room or game not found' });
    }
    
    const gameState = room.gameState;
    const playerIndex = gameState.players.findIndex(p => p.id === playerId);
    
    if (playerIndex === -1) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    if (playerIndex !== gameState.currentPlayerIndex) {
      return res.status(400).json({ error: 'Not your turn' });
    }
    
    const player = gameState.players[playerIndex];
    
    if (player.folded || player.allIn) {
      return res.status(400).json({ error: 'Player cannot act' });
    }
    
    // Process the action
    switch (action) {
      case 'fold':
        player.folded = true;
        break;
        
      case 'call':
        const callAmount = gameState.currentBet - player.bet;
        const actualCall = Math.min(callAmount, player.chips);
        player.bet += actualCall;
        player.chips -= actualCall;
        gameState.pot += actualCall;
        if (player.chips === 0) player.allIn = true;
        break;
        
      case 'raise':
        if (amount <= gameState.currentBet) {
          return res.status(400).json({ error: 'Raise amount too small' });
        }
        const raiseAmount = amount - player.bet;
        const actualRaise = Math.min(raiseAmount, player.chips);
        player.bet += actualRaise;
        player.chips -= actualRaise;
        gameState.pot += actualRaise;
        gameState.currentBet = player.bet;
        if (player.chips === 0) player.allIn = true;
        break;
        
      case 'all-in':
        gameState.pot += player.chips;
        player.bet += player.chips;
        player.chips = 0;
        player.allIn = true;
        if (player.bet > gameState.currentBet) {
          gameState.currentBet = player.bet;
        }
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Move to next player
    do {
      gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    } while (gameState.players[gameState.currentPlayerIndex].folded || gameState.players[gameState.currentPlayerIndex].allIn);
    
    console.log(`Player ${playerId} performed ${action} in room ${roomCode}`);
    
    res.json({
      game: {
        roomCode: room.code,
        players: room.players,
        settings: room.settings,
        gameStarted: room.gameStarted,
        gameState: room.gameState
      }
    });
  } catch (error) {
    console.error('Betting action error:', error);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// Sync game state
app.get('/api/rooms/:roomCode/sync', (req, res) => {
  try {
    const { roomCode } = req.params;
    const { playerId } = req.query;
    
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Verify player is in the room
    const playerInRoom = room.players.find(p => p.id === playerId);
    if (!playerInRoom) {
      return res.status(403).json({ error: 'Player not in room' });
    }
    
    res.json({
      game: {
        roomCode: room.code,
        players: room.players,
        settings: room.settings,
        gameStarted: room.gameStarted,
        gameState: room.gameState
      }
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Poker backend server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Cleanup old rooms every hour
setInterval(() => {
  const now = new Date();
  for (const [code, room] of rooms.entries()) {
    const roomAge = now - new Date(room.createdAt);
    if (roomAge > 24 * 60 * 60 * 1000) { // 24 hours
      console.log(`Cleaning up old room: ${code}`);
      // Remove players from this room
      for (const player of room.players) {
        players.delete(player.id);
      }
      rooms.delete(code);
    }
  }
}, 60 * 60 * 1000); // Run every hour