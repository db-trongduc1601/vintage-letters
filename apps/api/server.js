const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');

// We use the generated client path as defined in schema.prisma output
let PrismaClient;
try {
  PrismaClient = require('./generated/prisma').PrismaClient;
} catch (e) {
  // Fallback to @prisma/client if generated/prisma doesn't exist yet
  PrismaClient = require('@prisma/client').PrismaClient;
}

const prisma = new PrismaClient({});
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' }
});

const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register_socket', (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered socket ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
  });
});

app.use(cors());
app.use(express.json());

// Setup uploads directory for static files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const JWT_SECRET = process.env.JWT_SECRET || 'vintage-letter-secret-key-123';

// Configure multer for stamp uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'stamp-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// 1. POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, public_key } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already in use' });
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const newUser = await prisma.user.create({
      data: {
        username,
        email,
        password_hash,
        public_key
      }
    });

    res.status(201).json({ 
      message: 'User registered successfully', 
      user: { id: newUser.id, username: newUser.username }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { username }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ token, userId: user.id, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. GET /api/users/:username/public-key
app.get('/api/users/:username/public-key', async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { username },
      select: { public_key: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ public_key: user.public_key });
  } catch (error) {
    console.error('Get public key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. POST /api/letters
app.post('/api/letters', async (req, res) => {
  try {
    const { sender_id, receiver_id, encrypted_content, encrypted_key, stamp_id, status } = req.body;

    if (!sender_id || !receiver_id || !encrypted_content || !encrypted_key) {
      return res.status(400).json({ error: 'Missing required letter fields' });
    }

    const newLetter = await prisma.letter.create({
      data: {
        sender_id,
        receiver_id,
        encrypted_content,
        encrypted_key,
        stamp_id,
        status: status || 'DRAFT' // default DRAFT or SENT
      }
    });

    const receiverSocketId = userSockets.get(receiver_id);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('new_letter', newLetter);
    }

    res.status(201).json(newLetter);
  } catch (error) {
    console.error('Create letter error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. GET /api/letters/:receiver_id
app.get('/api/letters/:receiver_id', async (req, res) => {
  try {
    const { receiver_id } = req.params;
    
    const letters = await prisma.letter.findMany({
      where: {
        OR: [
          { receiver_id: receiver_id },
          { receiver: { username: receiver_id } }
        ]
      },
      include: {
        sender: {
          select: { username: true }
        }
      },
      orderBy: {
        sent_at: 'desc'
      }
    });

    res.json(letters);
  } catch (error) {
    console.error('Get letters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. POST /api/upload/stamp
app.post('/api/upload/stamp', upload.single('stamp'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = `/uploads/${req.file.filename}`;
    res.json({ message: 'Stamp uploaded successfully', path: filePath });
  } catch (error) {
    console.error('Upload stamp error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
