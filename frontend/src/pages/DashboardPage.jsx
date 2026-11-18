import { useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmUpload,
  createFolder,
  deleteFile,
  deleteFolder,
  fetchFilePreview,
  fetchFileVersions,
  fetchFiles,
  fetchFolders,
  fetchSharedFiles,
  generateFileDownloadUrl,
  generateShareLink,
  generateUploadUrl,
  MAX_UPLOAD_SIZE_BYTES,
  restoreVersion,
  uploadVersion,
  updateFile,
  updateFolder,
} from '../services/api';

const formatBytes = (size) => {
  if (!Number.isFinite(size) || size <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

function DashboardPage({ session, onLogout }) {
  const userName = session?.user?.name || 'User';
  const fileInputRef = useRef(null);
  const versionInputRef = useRef(null);
  const uploadInProgressRef = useRef(false);
  const versionUploadInProgressRef = useRef(false);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [versionModal, setVersionModal] = useState({ isOpen: false, file: null, versions: [] });
  const [folderName, setFolderName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [renameFolderId, setRenameFolderId] = useState('');
  const [renameFolderName, setRenameFolderName] = useState('');

  const loadFiles = async () => {
    if (!session?.token) return;

    const fileParams = {};
    if (searchTerm.trim()) fileParams.search = searchTerm.trim();
    if (selectedFolderId) fileParams.folderId = selectedFolderId;

    setIsLoading(true);
    try {
      const [filesResult, foldersResult, sharedResult] = await Promise.all([
        fetchFiles(session.token, fileParams),
        fetchFolders(session.token),
        fetchSharedFiles(session.token),
      ]);

      setFiles(filesResult.files || []);
      setFolders(foldersResult.folders || []);
      setSharedFiles(sharedResult.shares || []);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to load files.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [session?.token, searchTerm, selectedFolderId]);

  const folderCounts = useMemo(() => {
    const counts = {};

    files.forEach((file) => {
      if (file.folderId) {
        counts[file.folderId] = (counts[file.folderId] || 0) + 1;
      }
    });

    return counts;
  }, [files]);

  const stats = useMemo(() => {
    const totalStorage = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

    return [
      { label: 'Files', value: String(files.length), color: 'blue' },
      { label: 'Folders', value: String(folders.length), color: 'green' },
      { label: 'Storage Used', value: formatBytes(totalStorage), color: 'orange' },
      { label: 'Shared', value: String(sharedFiles.length), color: 'purple' },
    ];
  }, [files, folders.length, sharedFiles.length]);

  const activeFolderName = selectedFolderId
    ? folders.find((folder) => folder.id === selectedFolderId)?.name || 'Selected folder'
    : 'All files';

  const recentFiles = files.slice(0, 3).map((file) => ({
    id: file.id,
    name: file.originalName,
    type: file.mimeType || 'file',
    size: formatBytes(file.size),
    date: new Date(file.createdAt).toLocaleDateString(),
  }));

  const recentActivity = files.length
    ? files.slice(0, 4).map((file) => `Uploaded ${file.originalName}`)
    : ['No files uploaded yet.'];

  const handleUpload = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile || !session?.token || uploadInProgressRef.current) {
      return;
    }

    uploadInProgressRef.current = true;
    setIsUploading(true);
    const mimeType = selectedFile.type || 'application/octet-stream';

    try {
      setErrorMessage('');
      setNoticeMessage('Uploading file...');
      if (selectedFile.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error('File exceeds the maximum allowed size.');
      }

      const uploadData = await generateUploadUrl(
        session.token,
        selectedFile.name,
        mimeType,
        selectedFolderId || null,
        selectedFile.size,
      );

      if (!uploadData.uploadUrl || !uploadData.file?.id) {
        throw new Error('The server did not return a valid upload URL.');
      }

      const uploadResponse = await fetch(uploadData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache',
        },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Storage upload failed (HTTP ${uploadResponse.status}).`);
      }

      await confirmUpload(session.token, uploadData.file.id, selectedFile.size);
      await loadFiles();
      setNoticeMessage(`${selectedFile.name} uploaded successfully.`);
    } catch (error) {
      setErrorMessage(error.message ? `Upload failed: ${error.message}` : 'Upload failed. Please try again.');
    } finally {
      uploadInProgressRef.current = false;
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCreateFolder = async (event) => {
    event.preventDefault();
    if (!folderName.trim() || !session?.token) {
      return;
    }

    try {
      setErrorMessage('');
      await createFolder(session.token, folderName.trim());
      setFolderName('');
      await loadFiles();
      setNoticeMessage('Folder created.');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to create folder.');
    }
  };

  const handleDownloadFile = async (file) => {
    try {
      setErrorMessage('');
      const result = await generateFileDownloadUrl(session.token, file.id);
      if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setErrorMessage(error.message || 'Unable to download file.');
    }
  };

  const handlePreviewFile = async (file) => {
    try {
      setErrorMessage('');
      const result = await fetchFilePreview(session.token, file.id);
      if (result.canPreview && result.previewUrl) {
        window.open(result.previewUrl, '_blank', 'noopener,noreferrer');
        return;
      }

      setNoticeMessage('This file type is not previewable in the browser.');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to preview file.');
    }
  };

  const handleShareFile = async (file) => {
    try {
      setErrorMessage('');
      const result = await generateShareLink(session.token, file.id, 60);
      const shareLink = result.share?.shareUrl;

      if (!shareLink) {
        throw new Error('Share link is unavailable.');
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        window.prompt('Copy this share link:', shareLink);
      }

      setNoticeMessage('Share link copied to clipboard.');
      await loadFiles();
    } catch (error) {
      setErrorMessage(error.message || 'Unable to share file.');
    }
  };

  const handleDeleteFile = async (fileId) => {
    try {
      setErrorMessage('');
      const file = files.find((item) => item.id === fileId);
      if (!file) return;

      const shouldDelete = window.confirm(`Delete ${file.originalName}?`);
      if (!shouldDelete) {
        return;
      }

      await deleteFile(session.token, fileId);
      await loadFiles();
      setNoticeMessage(`${file.originalName} deleted.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to delete file.');
    }
  };

  const handleRenameFile = async (file) => {
    const nextName = window.prompt('Rename file:', file.originalName);
    if (nextName === null) return;

    const trimmed = nextName.trim();
    if (!trimmed) {
      setErrorMessage('File name cannot be empty.');
      return;
    }

    try {
      setErrorMessage('');
      await updateFile(session.token, file.id, { originalName: trimmed });
      await loadFiles();
      setNoticeMessage(`${file.originalName} renamed to ${trimmed}.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to rename file.');
    }
  };

  const handleMoveFileToFolder = async (file) => {
    const nextFolderId = window.prompt('Enter folder id to move this file into (or leave blank to move to root):', file.folderId || '');
    if (nextFolderId === null) return;

    try {
      setErrorMessage('');
      await updateFile(session.token, file.id, { folderId: nextFolderId.trim() || null });
      await loadFiles();
      setNoticeMessage(`${file.originalName} moved.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to move file.');
    }
  };

  const openVersionModal = async (file) => {
    try {
      setErrorMessage('');
      const result = await fetchFileVersions(session.token, file.id);
      setVersionModal({
        isOpen: true,
        file,
        versions: result.versions || [],
      });
    } catch (error) {
      setErrorMessage(error.message || 'Unable to load file versions.');
    }
  };

  const handleVersionUpload = async (event) => {
    const selectedFile = event.target.files?.[0];
    const activeFile = versionModal.file;

    if (!selectedFile || !session?.token || !activeFile || versionUploadInProgressRef.current) {
      return;
    }

    versionUploadInProgressRef.current = true;
    setIsUploadingVersion(true);
    try {
      setErrorMessage('');
      await uploadVersion(session.token, activeFile.id, selectedFile);
      await openVersionModal(activeFile);
      await loadFiles();
      setNoticeMessage(`${selectedFile.name} uploaded as a new version.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to upload a new version.');
    } finally {
      versionUploadInProgressRef.current = false;
      setIsUploadingVersion(false);
      if (versionInputRef.current) {
        versionInputRef.current.value = '';
      }
    }
  };

  const handleRestoreVersion = async (file, version) => {
    try {
      setErrorMessage('');
      const shouldRestore = window.confirm(`Restore version ${version.versionNumber} for ${file.originalName}?`);
      if (!shouldRestore) {
        return;
      }

      await restoreVersion(session.token, file.id, version.id);
      await openVersionModal(file);
      await loadFiles();
      setNoticeMessage(`Version ${version.versionNumber} restored.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to restore version.');
    }
  };

  const handleDeleteFolder = async (folderId) => {
    try {
      setErrorMessage('');
      const folder = folders.find((item) => item.id === folderId);
      if (!folder) return;

      const shouldDelete = window.confirm(`Delete folder "${folder.name}"?`);
      if (!shouldDelete) return;

      await deleteFolder(session.token, folderId);
      if (selectedFolderId === folderId) {
        setSelectedFolderId('');
      }
      await loadFiles();
      setNoticeMessage(`${folder.name} deleted.`);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to delete folder.');
    }
  };

  const handleRenameFolder = async (event) => {
    event.preventDefault();
    if (!renameFolderId || !renameFolderName.trim()) return;

    try {
      setErrorMessage('');
      await updateFolder(session.token, renameFolderId, renameFolderName.trim());
      setRenameFolderId('');
      setRenameFolderName('');
      await loadFiles();
      setNoticeMessage('Folder renamed.');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to rename folder.');
    }
  };

  const renderDashboardView = () => (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow accent">Overview</p>
          <h2>Welcome back, {userName}</h2>
        </div>
        <div className="storage-widget">
          <span>Storage usage</span>
          <strong>{files.length ? `${Math.min(100, (files.reduce((sum, file) => sum + (Number(file.size) || 0), 0) / 1_600_000_000) * 100).toFixed(0)}% of 16 GB used` : '0% of 16 GB used'}</strong>
          <div className="progress-bar">
            <span style={{ width: `${Math.min(100, (files.reduce((sum, file) => sum + (Number(file.size) || 0), 0) / 1_600_000_000) * 100)}%` }}></span>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className={`stat-card ${stat.color}`}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Recent files</h3>
            <button type="button" className="link-button" onClick={() => setActiveView('files')}>View all</button>
          </div>

          <div className="file-list">
            {recentFiles.length ? (
              recentFiles.map((file) => (
                <div key={file.id} className="file-row">
                  <div className="file-meta">
                    <div className="file-icon">📄</div>
                    <div>
                      <strong>{file.name}</strong>
                      <small>{file.type}</small>
                    </div>
                  </div>
                  <span>{file.size}</span>
                  <span>{file.date}</span>
                </div>
              ))
            ) : (
              <p className="empty-state">No uploaded files yet.</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Quick access</h3>
            <button type="button" className="link-button" onClick={() => setActiveView('folders')}>Manage</button>
          </div>

          <div className="quick-access-grid">
            <div className="quick-card"><span>📁</span><strong>Work</strong></div>
            <div className="quick-card"><span>🖼️</span><strong>Photos</strong></div>
            <div className="quick-card"><span>📚</span><strong>Documents</strong></div>
            <div className="quick-card"><span>🎬</span><strong>Videos</strong></div>
          </div>
        </div>
      </section>

      <section className="panel full-width">
        <div className="panel-header">
          <h3>Recent activity</h3>
          <button type="button" className="link-button" onClick={() => setActiveView('shared')}>Shared</button>
        </div>

        <ul className="activity-list">
          {recentActivity.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );

  const renderFilesView = () => (
    <section className="panel file-manager-panel">
      <div className="panel-header file-manager-header">
        <h3>My Files</h3>
        <div className="file-toolbar">
          <div className="folder-filter-wrap">
            <label htmlFor="folderFilter" className="sr-only">Filter by folder</label>
            <select
              id="folderFilter"
              value={selectedFolderId}
              onChange={(event) => setSelectedFolderId(event.target.value)}
              className="filter-select"
            >
              <option value="">All folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search files"
            className="search-inline"
            aria-label="Search files"
          />
          <button type="button" className="secondary-button small-button" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
            {isUploading ? 'Uploading...' : 'Upload file'}
          </button>
          <form onSubmit={handleCreateFolder} className="folder-form">
            <input
              type="text"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="New folder"
              aria-label="New folder name"
            />
            <button type="submit" className="secondary-button small-button">Create folder</button>
          </form>
        </div>
      </div>

      <div className="file-manager-grid">
        <div className="folder-list panel-subsection">
          <div className="panel-header compact-header">
            <h4>Folders</h4>
            {selectedFolderId ? (
              <button type="button" className="link-button small-link" onClick={() => setSelectedFolderId('')}>Clear filter</button>
            ) : null}
          </div>

          {folders.length ? (
            folders.map((folder) => (
              <div key={folder.id} className={`folder-item ${selectedFolderId === folder.id ? 'selected' : ''}`}>
                <span>📁</span>
                <div className="folder-item-copy">
                  <strong>{folder.name}</strong>
                  <small>{folderCounts[folder.id] || 0} files</small>
                </div>
                <div className="folder-actions">
                  <button type="button" className="mini-action" onClick={() => setSelectedFolderId(folder.id)}>Open</button>
                  <button type="button" className="mini-action" onClick={() => {
                    setRenameFolderId(folder.id);
                    setRenameFolderName(folder.name);
                  }}>Rename</button>
                  <button type="button" className="mini-action danger" onClick={() => handleDeleteFolder(folder.id)}>Delete</button>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-state">No folders yet.</p>
          )}
        </div>

        <div className="file-table-wrap panel-subsection">
          <div className="panel-header compact-header">
            <h4>{selectedFolderId ? activeFolderName : 'Files'}</h4>
            {selectedFolderId ? (
              <button type="button" className="link-button small-link" onClick={() => setSelectedFolderId('')}>All files</button>
            ) : null}
          </div>

          {isLoading ? <p className="empty-state">Loading files...</p> : (
            <table className="file-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.length ? files.map((file) => (
                  <tr key={file.id}>
                    <td>{file.originalName}</td>
                    <td>{file.mimeType || 'file'}</td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{new Date(file.updatedAt).toLocaleDateString()}</td>
                    <td className="file-actions">
                      <button type="button" className="mini-action" onClick={() => handleDownloadFile(file)}>Download</button>
                      <button type="button" className="mini-action" onClick={() => handlePreviewFile(file)}>Preview</button>
                      <button type="button" className="mini-action" onClick={() => handleShareFile(file)}>Share</button>
                      <button type="button" className="mini-action" onClick={() => handleRenameFile(file)}>Rename</button>
                      <button type="button" className="mini-action" onClick={() => handleMoveFileToFolder(file)}>Move</button>
                      <button type="button" className="mini-action" onClick={() => openVersionModal(file)}>Versions</button>
                      <button type="button" className="mini-action danger" onClick={() => handleDeleteFile(file.id)}>Delete</button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="5" className="empty-state">No files uploaded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {renameFolderId ? (
        <form onSubmit={handleRenameFolder} className="rename-folder-form">
          <input
            type="text"
            value={renameFolderName}
            onChange={(event) => setRenameFolderName(event.target.value)}
            placeholder="Folder name"
            aria-label="Rename folder"
          />
          <button type="submit" className="secondary-button small-button">Save</button>
          <button type="button" className="mini-action" onClick={() => {
            setRenameFolderId('');
            setRenameFolderName('');
          }}>Cancel</button>
        </form>
      ) : null}
    </section>
  );

  const renderFoldersView = () => (
    <section className="panel file-manager-panel">
      <div className="panel-header">
        <h3>Folders</h3>
        <button type="button" className="secondary-button small-button" onClick={() => setActiveView('files')}>Back to files</button>
      </div>
      <div className="stack-list">
        {folders.length ? folders.map((folder) => (
          <div key={folder.id} className="folder-card">
            <div>
              <p className="eyebrow">Folder</p>
              <h4>{folder.name}</h4>
            </div>
            <div className="folder-meta">
              <span>{folderCounts[folder.id] || 0} files</span>
              <button type="button" className="mini-action" onClick={() => {
                setSelectedFolderId(folder.id);
                setActiveView('files');
              }}>Open</button>
              <button type="button" className="mini-action" onClick={() => {
                setRenameFolderId(folder.id);
                setRenameFolderName(folder.name);
                setActiveView('files');
              }}>Rename</button>
              <button type="button" className="mini-action danger" onClick={() => handleDeleteFolder(folder.id)}>Delete</button>
            </div>
          </div>
        )) : (
          <p className="empty-state">No folders created yet.</p>
        )}
      </div>
    </section>
  );

  const renderSharedView = () => (
    <section className="panel file-manager-panel">
      <div className="panel-header">
        <h3>Shared Files</h3>
      </div>
      <div className="stack-list">
        {sharedFiles.length ? sharedFiles.map(({ share, file }) => (
          <div key={share.id} className="folder-card">
            <div>
              <p className="eyebrow">Shared link</p>
              <h4>{file.originalName}</h4>
            </div>
            <div className="folder-meta">
              <span>Expires {new Date(share.expiresAt).toLocaleDateString()}</span>
              <button type="button" className="mini-action" onClick={() => window.open(share.shareUrl, '_blank', 'noopener,noreferrer')}>Open</button>
            </div>
          </div>
        )) : (
          <p className="empty-state">No shared files yet.</p>
        )}
      </div>
    </section>
  );

  const renderSettingsView = () => (
    <section className="panel file-manager-panel">
      <div className="panel-header">
        <h3>Settings</h3>
      </div>
      <div className="settings-panel">
        <div className="setting-item">
          <span>Account</span>
          <strong>{userName}</strong>
        </div>
        <div className="setting-item">
          <span>Email</span>
          <strong>{session?.user?.email}</strong>
        </div>
        <div className="setting-item">
          <span>Storage plan</span>
          <strong>Starter</strong>
        </div>
      </div>
    </section>
  );

  const renderCurrentView = () => {
    if (activeView === 'files') return renderFilesView();
    if (activeView === 'folders') return renderFoldersView();
    if (activeView === 'shared') return renderSharedView();
    if (activeView === 'settings') return renderSettingsView();
    return renderDashboardView();
  };

  const renderVersionModal = () => {
    if (!versionModal.isOpen || !versionModal.file) {
      return null;
    }

    return (
      <div className="version-overlay" onClick={() => setVersionModal({ isOpen: false, file: null, versions: [] })}>
        <div className="version-modal" onClick={(event) => event.stopPropagation()}>
          <div className="panel-header">
            <h3>{versionModal.file.originalName} versions</h3>
            <button type="button" className="link-button" onClick={() => setVersionModal({ isOpen: false, file: null, versions: [] })}>Close</button>
          </div>

          <div className="version-toolbar">
            <button type="button" className="secondary-button small-button" disabled={isUploadingVersion} onClick={() => versionInputRef.current?.click()}>
              {isUploadingVersion ? 'Uploading version...' : 'Upload new version'}
            </button>
            <input ref={versionInputRef} type="file" hidden disabled={isUploadingVersion} onChange={handleVersionUpload} />
          </div>

          <div className="version-list">
            {versionModal.versions.length ? (
              versionModal.versions.map((version) => (
                <div key={version.id} className="version-item">
                  <div>
                    <strong>Version {version.versionNumber}</strong>
                    <small>{new Date(version.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="version-meta">
                    <span>{formatBytes(version.size)}</span>
                    <button type="button" className="mini-action" onClick={() => handleRestoreVersion(versionModal.file, version)}>Restore</button>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-state">No versions available for this file.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-mark small">K</div>
          <div>
            <p className="eyebrow">Cloud workspace</p>
            <h3>KGK Storage</h3>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button type="button" className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveView('dashboard')}>Dashboard</button>
          <button type="button" className={`nav-item ${activeView === 'files' ? 'active' : ''}`} onClick={() => setActiveView('files')}>My Files</button>
          <button type="button" className={`nav-item ${activeView === 'folders' ? 'active' : ''}`} onClick={() => setActiveView('folders')}>My Folders</button>
          <button type="button" className={`nav-item ${activeView === 'shared' ? 'active' : ''}`} onClick={() => setActiveView('shared')}>Shared Files</button>
          <button type="button" className="nav-item">Recent Files</button>
          <button type="button" className="nav-item">Starred</button>
          <button type="button" className="nav-item">Trash</button>
          <button type="button" className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')}>Settings</button>
        </nav>

        <div className="profile-card">
          <div>
            <strong>{userName}</strong>
            <small>{session?.user?.email}</small>
          </div>
          <button type="button" className="logout-button" onClick={onLogout}>Logout</button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div className="search-box">
            <span>🔎</span>
            <input type="text" value={searchTerm} placeholder="Search files and folders" onChange={(event) => setSearchTerm(event.target.value)} />
          </div>

          <div className="topbar-actions">
            <button type="button" className="secondary-button" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
            <select
              className="folder-choice"
              value={selectedFolderId}
              onChange={(event) => setSelectedFolderId(event.target.value)}
              aria-label="Choose upload folder"
            >
              <option value="">Upload to root</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <input ref={fileInputRef} type="file" hidden disabled={isUploading} onChange={handleUpload} />
            <button type="button" className="avatar-button">{userName.charAt(0).toUpperCase()}</button>
          </div>
        </header>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
        {noticeMessage ? <p className="notice-banner">{noticeMessage}</p> : null}

        {renderCurrentView()}
        {renderVersionModal()}
      </main>
    </div>
  );
}

export default DashboardPage;
