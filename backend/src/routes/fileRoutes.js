const express = require('express');
const {
  listFiles,
  createUploadUrl,
  confirmUpload,
  updateFile,
  createDownloadUrl,
  previewFile,
  createShare,
  accessSharedFile,
  listSharedFiles,
  createVersion,
  listVersions,
  confirmVersion,
  restoreVersion,
  deleteFile,
} = require('../controllers/fileController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/shared/:token', accessSharedFile);

router.use(protect);
router.get('/', listFiles);
router.get('/shared', listSharedFiles);
router.post('/upload-url', createUploadUrl);
router.post('/confirm-upload', confirmUpload);
router.put('/:id', updateFile);
router.get('/:id/versions', listVersions);
router.post('/:id/versions', createVersion);
router.post('/:id/versions/:versionId/confirm', confirmVersion);
router.post('/:id/versions/:versionId/restore', restoreVersion);
router.post('/:id/share', createShare);
router.get('/:id/download-url', createDownloadUrl);
router.get('/:id/preview', previewFile);
router.delete('/:id', deleteFile);

module.exports = router;
