const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { listFolders, createFolder, updateFolder, deleteFolder } = require('../controllers/folderController');

const router = express.Router();

router.use(protect);
router.get('/', listFolders);
router.post('/', createFolder);
router.put('/:id', updateFolder);
router.delete('/:id', deleteFolder);

module.exports = router;
