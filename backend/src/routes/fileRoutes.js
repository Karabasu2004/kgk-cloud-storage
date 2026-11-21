const express = require('express');
const {
  getUserQuotaInfo,
  listFiles,
  listRecentFiles,
  listStarredFiles,
  toggleStar,
  listTrashFiles,
  restoreFile,
  permanentDeleteFile,
  createUploadUrl,
  confirmUpload,
  cancelUpload,
  cancelVersionUpload,
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
router.get('/recent', listRecentFiles);
router.get('/starred', listStarredFiles);
router.get('/trash', listTrashFiles);
router.get('/quota', getUserQuotaInfo);
router.get('/shared', listSharedFiles);
router.post('/upload-url', createUploadUrl);
router.post('/confirm-upload', confirmUpload);
router.put('/:id', updateFile);
router.patch('/:id/star', toggleStar);
router.post('/:id/restore', restoreFile);
router.delete('/:id/permanent', permanentDeleteFile);
router.delete('/:id/cancel', cancelUpload);
router.get('/:id/versions', listVersions);
router.post('/:id/versions', createVersion);
router.post('/:id/versions/:versionId/confirm', confirmVersion);
router.delete('/:id/versions/:versionId/cancel', cancelVersionUpload);
router.post('/:id/versions/:versionId/restore', restoreVersion);
router.post('/:id/share', createShare);
router.get('/:id/download-url', createDownloadUrl);
router.get('/:id/preview', previewFile);
router.delete('/:id', deleteFile);

module.exports = router;
