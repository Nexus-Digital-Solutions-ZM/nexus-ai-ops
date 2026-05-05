const express = require('express');
const router = express.Router();
const { findUser, verifyPassword, generateToken, requireAuth } = require('../services/auth');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = findUser(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user);

    // Set httpOnly cookie
    res.cookie('nexus_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      user: { id: user.id, name: user.name, role: user.role, initials: user.initials }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('nexus_token');
  res.json({ success: true });
});

// GET /auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
