const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { inMemoryUsers } = require('../config/database');
const { getJwtSecret } = require('../config/jwt');
const { User } = require('../models');

const isMongoReady = () => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (process.env.NODE_ENV === 'production') {
    const error = new Error('Database temporarily unavailable');
    error.statusCode = 503;
    throw error;
  }

  return false;
};

const signToken = (user) => {
  return jwt.sign(
    {
      userId: user.id || user._id?.toString?.() || user._id,
      email: user.email,
      name: user.name,
    },
    getJwtSecret(),
    {
      expiresIn: '7d',
    }
  );
};

const sanitizeUser = (user) => ({
  id: user.id || user._id?.toString?.() || user._id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const registerUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (isMongoReady()) {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }

      const newUser = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: await bcrypt.hash(password, 10),
      });

      const token = signToken(newUser.toObject());
      return res.status(201).json({
        message: 'User registered successfully.',
        token,
        user: sanitizeUser(newUser.toObject()),
      });
    }

    const existingUser = inMemoryUsers.find((user) => user.email === normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const newUser = {
      id: `user-${Date.now()}`,
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    inMemoryUsers.push(newUser);
    const token = signToken(newUser);

    return res.status(201).json({
      message: 'User registered successfully.',
      token,
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (isMongoReady()) {
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }

      const token = signToken(user.toObject());
      return res.status(200).json({
        message: 'Login successful.',
        token,
        user: sanitizeUser(user.toObject()),
      });
    }

    const user = inMemoryUsers.find((savedUser) => savedUser.email === normalizedEmail);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = signToken(user);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentUser = async (req, res, next) => {
  try {
    if (isMongoReady()) {
      const currentUser = await User.findById(req.user.userId);
      if (!currentUser) {
        return res.status(404).json({ message: 'User not found.' });
      }

      return res.status(200).json({
        user: sanitizeUser(currentUser.toObject()),
      });
    }

    const currentUser = inMemoryUsers.find((user) => user.id === req.user.userId || user._id === req.user.userId);

    if (!currentUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      user: sanitizeUser(currentUser),
    });
  } catch (error) {
    next(error);
  }
};

const logoutUser = (req, res) => {
  return res.status(200).json({
    message: 'Logged out successfully.',
  });
};

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
  logoutUser,
};
