# KGK CLOUD STORAGE
## Cloud-Based File Storage and Management System

**Project Name:** KGK Cloud Storage  
**Project Type:** Full-Stack Cloud Computing Application  
**Project Version:** 1.0  
**Development Status:** In Progress  
**Developer:** Karabasappa G. Karinagannanavar

---

# 1. PROJECT OVERVIEW

KGK Cloud Storage is a cloud-based file storage and management web application inspired by Google Drive.

The main objective is to develop a secure, scalable and user-friendly platform where users can register, log in, upload files, download files, organize folders, share files and manage their documents through a web interface.

All actual uploaded files will be stored in Amazon Web Services (AWS) S3. User information and file metadata will be maintained in MongoDB.

The application will provide a modern dashboard where users can manage their personal cloud storage.

This project is intended to demonstrate practical knowledge of:

- Cloud Computing
- Amazon Web Services (AWS)
- Amazon S3
- Full-Stack Web Development
- REST API Development
- Database Management
- Authentication and Authorization
- Cloud Security
- Deployment and DevOps
- Git and GitHub

# 2. PROJECT OBJECTIVES

1. Develop a Google Drive-inspired cloud storage application.
2. Integrate AWS S3 for cloud file storage.
3. Implement secure user registration and login.
4. Allow users to upload and download files.
5. Implement file and folder management.
6. Implement secure file sharing.
7. Enable file versioning.
8. Display storage usage and file statistics.
9. Build a responsive and modern user interface.
10. Deploy the application and publish the source code on GitHub.

# 3. TECHNOLOGY STACK

## Frontend
- React.js
- Vite
- JavaScript
- HTML5
- CSS3
- Tailwind CSS
- Lucide React Icons
- Axios

## Backend
- Node.js
- Express.js
- REST APIs
- Multer (where server-side multipart handling is needed)
- AWS SDK for JavaScript v3
- JWT authentication
- bcrypt password hashing

## Database
- MongoDB
- Mongoose

## Cloud Infrastructure
- AWS S3
- AWS IAM
- AWS CLI
- S3 Versioning
- S3 Pre-signed URLs
- AWS CloudWatch (optional monitoring)

## Development Tools
- Visual Studio Code
- Git
- GitHub
- Postman
- MongoDB Compass
- AWS Management Console

# 4. APPLICATION FEATURES

## 4.1 User Authentication

Users should be able to:

- Register a new account.
- Log in using email and password.
- Log out.
- View their profile.
- Change their password.
- Access only their own files.
- Maintain an authenticated session.

Security requirements:

- Passwords must be hashed using bcrypt.
- JWT should be stored in secure HttpOnly cookies.
- Backend APIs must verify authentication.
- Users must not access another user's files without authorization.

## 4.2 Dashboard

The dashboard is the main page after successful login.

It should display:

- Welcome message with the user's name.
- Total uploaded files.
- Total folders.
- Storage used.
- Available storage quota.
- Recently uploaded files.
- Quick upload button.
- Recent activity.

The dashboard should have a storage usage progress bar.

## 4.3 File Upload

Users should be able to:

- Upload single files.
- Upload multiple files.
- Upload images.
- Upload PDF documents.
- Upload Word documents.
- Upload Excel files.
- Upload videos.
- Upload ZIP files.
- See upload progress.
- Cancel uploads.
- Receive upload success or error messages.

Storage process:

1. User selects a file.
2. React sends a request to the backend.
3. Backend authenticates the user.
4. Backend validates the file.
5. Backend generates a pre-signed S3 upload URL.
6. Frontend uploads the file directly to S3 using that URL.
7. Backend records file metadata in MongoDB after successful upload.
8. The uploaded file appears in the dashboard.

Do not expose AWS credentials in frontend code.

## 4.4 File Management

Users should be able to:

- View uploaded files.
- Search files by name.
- Filter by file type.
- Sort by name.
- Sort by upload date.
- Sort by file size.
- Download files.
- Rename files.
- Delete files.
- View file details.
- Preview supported files.

Supported file categories:

- Images
- Documents
- Videos
- Audio
- Archives
- Other files

## 4.5 Folder Management

Users should be able to:

- Create folders.
- Rename folders.
- Delete folders.
- Open folders.
- Upload files inside folders.
- Move files between folders.
- Navigate using breadcrumbs.

Folders can initially be implemented as logical folders using MongoDB metadata and S3 object-key prefixes.

## 4.6 File Sharing

Users should be able to:

- Generate a file-sharing link.
- Set link expiration.
- Revoke a sharing link.
- Share files securely.
- View sharing status.

Sharing should use time-limited pre-signed download URLs or a controlled backend sharing endpoint.

Only authorized users should be able to generate sharing links.

## 4.7 File Versioning

Enable S3 bucket versioning.

Users should eventually be able to:

- Upload a new version of an existing file.
- View previous versions.
- View version upload dates.
- Download previous versions.
- Restore an earlier version.

MongoDB should store the relevant S3 Version IDs and file metadata.

## 4.8 Profile and Settings

Provide:

- User profile.
- Name and email.
- Password change.
- Storage usage.
- Account settings.
- Logout option.

# 5. USER INTERFACE DESIGN

The application should have a professional SaaS-style design.

Design inspiration:
- Google Drive
- Dropbox
- OneDrive
- Modern cloud management dashboards

The interface must be clean, simple, professional and easy to navigate.

## 5.1 Design Theme

Suggested design direction:

- Primary color: Deep navy blue.
- Secondary color: Sky blue.
- Background: Very light grey.
- Cards: White.
- Text: Dark charcoal.
- Success: Green.
- Warning: Orange.
- Danger: Red.

Use consistent spacing, rounded cards, subtle shadows and modern typography.

Avoid excessive animations and unnecessary decorative elements.

## 5.2 Login Page

The login page should contain:

- KGK Cloud Storage logo.
- Welcome heading.
- Email input.
- Password input.
- Show/hide password option.
- Remember me option if session behavior supports it.
- Login button.
- Forgot password link (once password recovery is implemented).
- Create account link.

## 5.3 Registration Page

The registration page should contain:

- Full name.
- Email.
- Password.
- Confirm password.
- Password validation.
- Register button.
- Link to login page.

## 5.4 Main Dashboard Layout

The dashboard should use a sidebar and main content area.

### Sidebar

Display:

- KGK Cloud Storage logo.
- Dashboard.
- My Files.
- My Folders.
- Shared Files.
- Recent Files.
- Starred Files.
- Trash.
- Settings.
- User profile at the bottom.

### Top Navigation

Display:

- Search bar.
- Notifications icon (if notifications are implemented).
- User profile menu.
- Upload button.

### Main Dashboard

Display:

1. Welcome message.
2. Storage overview card.
3. Total files card.
4. Total folders card.
5. Recent files section.
6. Quick access section.
7. Recent activity section.

## 5.5 My Files Page

Display uploaded files in:

- Grid view.
- List view.

Each file should show:

- File icon or thumbnail.
- File name.
- File type.
- File size.
- Last modified date.
- Owner.
- Actions menu.

Actions:

- Preview.
- Download.
- Rename.
- Share.
- Move.
- Delete.

## 5.6 Upload Interface

Create a modern drag-and-drop upload area.

Display:

- Drag and drop message.
- Select files button.
- Upload progress.
- File size.
- Upload status.
- Cancel button.

## 5.7 Shared Files Page

Display:

- File name.
- Sharing link status.
- Expiration date.
- Created date.
- Revoke sharing option.

## 5.8 Responsive Design

The application must work on:

- Desktop computers.
- Laptops.
- Tablets.
- Mobile devices.

On mobile, the sidebar should become a collapsible navigation menu.

# 6. APPLICATION ARCHITECTURE

The application will follow a frontend-backend-cloud architecture.

### Frontend

React.js handles:
- User interface.
- Authentication screens.
- Dashboard.
- File selection.
- Upload progress.
- File listing.
- API communication.

### Backend

Node.js and Express handle:
- Authentication.
- Authorization.
- File validation.
- AWS S3 operations.
- Pre-signed URL generation.
- File metadata.
- Sharing permissions.
- Database operations.

### AWS S3

Amazon S3 handles:
- Actual file storage.
- File versioning.
- Object retrieval.
- Private object access.

### MongoDB

MongoDB stores:
- User details.
- Hashed passwords.
- File metadata.
- Folder information.
- Sharing information.
- Activity records.

### File Upload Architecture

React Frontend
        |
        v
Node.js Backend
        |
        v
Authentication and Validation
        |
        v
Generate S3 Pre-signed URL
        |
        v
React uploads directly to S3
        |
        v
S3 stores actual file
        |
        v
Backend saves metadata in MongoDB

# 7. DATABASE DESIGN

## User Collection

Fields:

- _id
- name
- email
- password
- createdAt
- updatedAt

## File Collection

Fields:

- _id
- userId
- originalName
- storedName
- s3Key
- bucketName
- versionId
- mimeType
- size
- folderId
- isStarred
- isDeleted
- createdAt
- updatedAt

## Folder Collection

Fields:

- _id
- userId
- name
- parentFolderId
- createdAt
- updatedAt

## SharedFile Collection

Fields:

- _id
- fileId
- ownerId
- tokenHash
- expiresAt
- revoked
- createdAt

Use appropriate MongoDB references, indexes and validation.

# 8. AWS S3 CONFIGURATION

The application will use the existing AWS S3 bucket created during infrastructure setup.

AWS region:
ap-south-1 (Mumbai)

Required configuration:

- Keep the bucket private.
- Keep Block Public Access enabled.
- Enable bucket versioning.
- Use server-side encryption.
- Use secure pre-signed URLs.
- Restrict IAM permissions.
- Avoid public bucket policies.

AWS SDK must use the AWS credential provider chain.

For local development, use the configured AWS CLI profile.

For production, use an IAM role or an equivalent secure workload identity.

Never hardcode AWS access keys in source code.

Never commit:
- AWS credentials.
- .env files.
- Private keys.
- Database passwords.
- JWT secrets.

Use environment variables for application configuration.

# 9. BACKEND API STRUCTURE

Suggested API endpoints:

## Authentication

POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me

## Files

GET /api/files
POST /api/files/upload-url
POST /api/files/confirm-upload
GET /api/files/:id/download-url
GET /api/files/:id
PATCH /api/files/:id
DELETE /api/files/:id

## Folders

POST /api/folders
GET /api/folders
GET /api/folders/:id
PATCH /api/folders/:id
DELETE /api/folders/:id

## Sharing

POST /api/shares
GET /api/shares
GET /api/shares/:token
DELETE /api/shares/:id

## File Versions

GET /api/files/:id/versions
POST /api/files/:id/versions
POST /api/files/:id/versions/:versionId/restore

These are planned routes. Implement and test them progressively.

All routes must validate input and enforce user authorization.

# 10. SUGGESTED PROJECT STRUCTURE

KGK-Cloud-Storage/

    backend/
        src/
            config/
                database.js
                aws.js

            controllers/
                authController.js
                fileController.js
                folderController.js
                shareController.js

            middleware/
                authMiddleware.js
                errorMiddleware.js

            models/
                User.js
                File.js
                Folder.js
                SharedFile.js

            routes/
                authRoutes.js
                fileRoutes.js
                folderRoutes.js
                shareRoutes.js

            services/
                s3Service.js

            utils/

            app.js
            server.js

        .env.example
        .gitignore
        package.json

    frontend/
        src/
            components/
            pages/
            layouts/
            services/
            hooks/
            context/
            assets/
            styles/
            App.jsx
            main.jsx

        package.json

    README.md
    .gitignore

# 11. ENVIRONMENT CONFIGURATION

Backend .env.example:

PORT=5000
NODE_ENV=development
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=replace_with_a_secure_random_secret
AWS_REGION=ap-south-1
AWS_S3_BUCKET=your_actual_bucket_name
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_PROFILE=your_aws_cli_profile_name
FRONTEND_URL=http://localhost:5173

The real .env must remain private and must never be committed.

AWS credentials should come from the AWS CLI profile or another secure credential provider, not from frontend environment variables. If `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are not set, the app will still try to use the AWS SDK default credential chain (including a configured CLI profile).

# 12. DEVELOPMENT PHASES

Follow these phases in order.

## Phase 1: Infrastructure Setup

- [x] Create AWS IAM user.
- [x] Create AWS IAM group.
- [x] Install AWS CLI.
- [x] Configure AWS CLI.
- [x] Verify AWS identity.
- [x] Create S3 bucket.
- [x] Verify S3 access from VS Code.
- [x] Verify Node.js.
- [x] Verify npm.
- [x] Verify Git.

## Phase 2: Project Initialization

- [x] Create project folder.
- [x] Initialize backend.
- [x] Install backend packages.
- [x] Initialize React frontend.
- [x] Configure environment variables.
- [x] Create initial project structure.

## Phase 3: Backend Development

- [x] Create Express server.
- [ ] Connect MongoDB.
- [x] Configure AWS SDK.
- [x] Implement authentication.
- [x] Implement protected routes.
- [ ] Implement S3 upload URL generation.
- [ ] Implement file upload confirmation.
- [ ] Implement download URL generation.
- [ ] Implement file deletion.
- [x] Implement folder APIs.
- [ ] Test APIs using Postman.

## Phase 4: Frontend Development

- [x] Create login page.
- [x] Create registration page.
- [x] Create dashboard layout.
- [x] Create sidebar.
- [x] Create top navigation.
- [ ] Create My Files page.
- [ ] Create folder page.
- [x] Create upload interface.
- [ ] Create shared files page.
- [ ] Create profile and settings.
- [x] Make the application responsive.

## Phase 5: Advanced Features

- [x] File search.
- [x] File filtering.
- [x] File sorting.
- [x] File preview.
- [x] File sharing.
- [x] File versioning.
- [ ] Storage usage calculation.
- [ ] Starred files.
- [ ] Trash and recovery.
- [ ] Activity history.

## Phase 6: Security and Testing

- [ ] Validate uploaded file types.
- [ ] Implement file size limits.
- [ ] Restrict user access.
- [ ] Configure CORS.
- [ ] Protect API endpoints.
- [ ] Validate sharing permissions.
- [ ] Check S3 bucket permissions.
- [ ] Test error handling.
- [ ] Test upload and download workflows.

## Phase 7: Deployment

- [ ] Prepare production environment.
- [ ] Deploy frontend.
- [ ] Deploy backend.
- [ ] Configure MongoDB hosting.
- [ ] Configure production IAM role.
- [ ] Configure environment variables.
- [ ] Configure CORS and allowed origins.
- [ ] Test live application.
- [ ] Add live application URL to GitHub README.

## Phase 8: GitHub Portfolio

- [ ] Create public GitHub repository.
- [ ] Add project README.
- [ ] Add application screenshots.
- [ ] Add architecture diagram.
- [ ] Add setup instructions.
- [ ] Add API documentation.
- [ ] Add deployment URL.
- [ ] Publish final project.

# 13. SECURITY REQUIREMENTS

Security is a priority.

1. S3 bucket must remain private.
2. No AWS access key or secret key in React.
3. No AWS credentials committed to GitHub.
4. Use least-privilege IAM policies.
5. Authenticate every protected API.
6. Verify file ownership before every operation.
7. Use short-lived pre-signed URLs.
8. Validate MIME types and file sizes.
9. Sanitize file names.
10. Hash passwords using bcrypt.
11. Use secure HttpOnly cookies.
12. Protect against unauthorized file access.
13. Validate sharing expiration and revocation.
14. Never trust frontend-supplied user IDs.
15. Do not expose internal S3 object keys unnecessarily.

Use an upload confirmation process that verifies the uploaded S3 object before saving its metadata.

# 14. GITHUB AND DEPLOYMENT REQUIREMENTS

Repository name:

KGK-Cloud-Storage

Suggested repository description:

A full-stack cloud-based file storage and management platform built with React, Node.js, MongoDB and AWS S3, featuring secure authentication, file uploads, downloads, sharing and version management.

The GitHub repository should contain:

- Complete source code.
- README.md.
- .env.example.
- Screenshots.
- Architecture documentation.
- Setup instructions.

Do not upload node_modules, .env, credentials or sensitive information.

# 15. FUTURE ENHANCEMENTS

After completing the core application, consider:

- Google OAuth login.
- Email verification.
- Password recovery.
- File activity notifications.
- Drag-and-drop file movement.
- File previews.
- Storage quota management.
- Admin dashboard.
- Multi-user collaboration.
- AWS CloudWatch monitoring.
- CloudFront integration.
- Automated backup and recovery.

These are optional future features, not requirements for the first working release.

# 16. INSTRUCTIONS FOR VS CODE AI AGENT

IMPORTANT: Read this entire README before modifying the project.

You are assisting in developing KGK Cloud Storage.

Follow these instructions:

1. Understand the project architecture before writing code.
2. Follow the defined technology stack.
3. Build the application in small, logical phases.
4. Do not generate the entire application in one step.
5. Explain every important file and its purpose.
6. Keep frontend and backend code separate.
7. Use reusable React components.
8. Use a clean folder structure.
9. Follow REST API conventions.
10. Use secure AWS SDK practices.
11. Never hardcode AWS credentials.
12. Never make the S3 bucket public.
13. Test every important feature before moving to the next phase.
14. Do not overwrite existing working code without checking it.
15. Keep this README updated when project milestones are completed.
16. Mark tasks as completed only after verifying them.
17. If an error occurs, explain the cause and provide a step-by-step fix.
18. Do not skip security requirements.
19. Do not install unnecessary packages.
20. Do not implement future enhancements before the core features work.

Before starting a new phase:

- Check the current project structure.
- Review existing code.
- Identify completed tasks.
- Identify pending tasks.
- Explain what you plan to implement.
- Then proceed with the implementation.

If the developer encounters an error, troubleshoot the existing implementation before rewriting it.

# 17. CURRENT PROJECT STATUS

Infrastructure:

- AWS account connected through AWS CLI.
- IAM user created.
- IAM group created.
- S3 bucket created.
- AWS CLI connection tested.
- Node.js installed.
- npm installed.
- Git installed.

Application:

- Project architecture planned.
- UI design requirements defined.
- Database structure planned.
- API structure planned.
- Development roadmap documented.
- Application implementation pending.

IMPORTANT SECURITY FOLLOW-UP:

An earlier development screenshot exposed an AWS secret access key. That key must be deactivated and deleted. A replacement key should be used locally, and the original IAM permissions should be reviewed and restricted before production.

# 18. FINAL PROJECT GOAL

The final goal is to develop and deploy a complete, functional cloud-based file storage application.

The application must allow users to register, log in, upload files to Amazon S3, organize files into folders, download files, share files securely and manage file versions.

The final application should have:

- A professional user interface.
- A functional React frontend.
- A working Node.js backend.
- A connected MongoDB database.
- Working AWS S3 integration.
- Secure authentication.
- Proper file management.
- Responsive design.
- Complete documentation.
- A public GitHub repository.
- A working live deployment.

**Development principle: Build step by step, test everything, maintain security, and document progress.**

**Project Name: KGK Cloud Storage**

**End of Project Specification.**