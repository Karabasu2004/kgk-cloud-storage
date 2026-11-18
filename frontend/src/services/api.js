const viteEnv = import.meta.env || {};
const API_BASE_URL = (
  viteEnv.VITE_API_BASE_URL ||
  (viteEnv.DEV ? 'http://localhost:5000/api' : '') ||
  (typeof process !== 'undefined' ? process.env.VITE_API_BASE_URL : '')
).replace(/\/+$/, '');

if (!API_BASE_URL) {
  throw new Error('VITE_API_BASE_URL is required in production.');
}

const configuredMaxUploadSize = Number(viteEnv.VITE_MAX_UPLOAD_SIZE_BYTES);
export const MAX_UPLOAD_SIZE_BYTES = Number.isSafeInteger(configuredMaxUploadSize) && configuredMaxUploadSize > 0
  ? configuredMaxUploadSize
  : 50 * 1024 * 1024;

const handleResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || 'Request failed.');
  }

  return payload;
};

const getAuthHeaders = (token, extraHeaders = {}) => ({
  ...extraHeaders,
  Authorization: `Bearer ${token}`,
});

export const loginUser = async (email, password) => {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  return handleResponse(response);
};

export const registerUser = async (name, email, password) => {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, email, password }),
  });

  return handleResponse(response);
};

export const fetchFiles = async (token, params = {}) => {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE_URL}/files${query ? `?${query}` : ''}`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const fetchFolders = async (token) => {
  const response = await fetch(`${API_BASE_URL}/folders`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const fetchSharedFiles = async (token) => {
  const response = await fetch(`${API_BASE_URL}/files/shared`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const createFolder = async (token, name, parentId = null) => {
  const response = await fetch(`${API_BASE_URL}/folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ name, parentId }),
  });

  return handleResponse(response);
};

export const updateFolder = async (token, folderId, name) => {
  const response = await fetch(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ name }),
  });

  return handleResponse(response);
};

export const deleteFolder = async (token, folderId) => {
  const response = await fetch(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const generateUploadUrl = async (token, fileName, mimeType, folderId = null, size) => {
  const response = await fetch(`${API_BASE_URL}/files/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ fileName, mimeType, folderId, size }),
  });

  return handleResponse(response);
};

export const updateFile = async (token, fileId, updates = {}) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify(updates),
  });

  return handleResponse(response);
};

export const generateFileDownloadUrl = async (token, fileId) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/download-url`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const fetchFilePreview = async (token, fileId) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/preview`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const generateShareLink = async (token, fileId, expiresInMinutes = 60) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ expiresInMinutes }),
  });

  return handleResponse(response);
};

export const fetchFileVersions = async (token, fileId) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/versions`, {
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const createVersion = async (token, fileId, fileName, mimeType, size) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/versions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ fileName, mimeType, size }),
  });

  return handleResponse(response);
};

export const confirmVersionUpload = async (token, fileId, versionId, size) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/versions/${versionId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ size }),
  });

  return handleResponse(response);
};

export const uploadVersion = async (token, fileId, file) => {
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('File exceeds the maximum allowed size.');
  }

  const mimeType = file.type || 'application/octet-stream';
  const uploadData = await createVersion(token, fileId, file.name, mimeType, file.size);

  if (!uploadData.uploadUrl || !uploadData.version?.id) {
    throw new Error('The server did not return a valid version upload URL.');
  }

  const uploadResponse = await fetch(uploadData.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Storage upload failed (HTTP ${uploadResponse.status}).`);
  }

  return confirmVersionUpload(token, fileId, uploadData.version.id, file.size);
};

export const restoreVersion = async (token, fileId, versionId) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}/versions/${versionId}/restore`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const deleteFile = async (token, fileId) => {
  const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });

  return handleResponse(response);
};

export const confirmUpload = async (token, fileId, size) => {
  const response = await fetch(`${API_BASE_URL}/files/confirm-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    body: JSON.stringify({ fileId, size }),
  });

  return handleResponse(response);
};
