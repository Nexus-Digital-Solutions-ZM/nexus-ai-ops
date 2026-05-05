const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'nexus-secret-change-in-production';
const JWT_EXPIRES = '7d';

// Hardcoded users — in production swap for a DB
const USERS = [
  {
    id: 'simeon',
    name: 'Simeon Mwale',
    role: 'admin',
    initials: 'SM',
    email: process.env.ADMIN_EMAIL || 'simeon@nexusdigital.zm',
    // Default password: nexus2026 — change via ADMIN_PASSWORD env
    passwordHash: null
  },
  {
    id: 'siddhartha',
    name: 'Siddhartha BitDev',
    role: 'partner',
    initials: 'SB',
    email: process.env.PARTNER_EMAIL || 'siddhartha@bitdev.com',
    passwordHash: null
  }
];

// Initialize password hashes at startup
async function initPasswords() {
  const adminPass = process.env.ADMIN_PASSWORD || 'nexus2026';
  const partnerPass = process.env.PARTNER_PASSWORD || 'bitdev2026';
  USERS[0].passwordHash = await bcrypt.hash(adminPass, 10);
  USERS[1].passwordHash = await bcrypt.hash(partnerPass, 10);
  console.log('✅ Auth initialized');
}

function findUser(email) {
  return USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, initials: user.initials },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware
function requireAuth(req, res, next) {
  const token = req.cookies?.nexus_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { initPasswords, findUser, verifyPassword, generateToken, verifyToken, requireAuth, requireAdmin };
