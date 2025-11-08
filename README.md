# multilingual-qa-js

Simple starter README for setting up frontend and backend for a multilingual Q&A app.

## Overview
Minimal instructions to install, configure, and run frontend and backend locally.

## Repo layout
```
/
├─ backend/
├─ frontend/
└─ README.md
```

## Quick start

1. Clone repository
```bash
git clone https://github.com/dexter-ifti/multilingual-document-qa.git
cd multilingual-document-qa
```

2. Install dependencies
```bash
# Backend
cd backend
npm install
cp .env.example .env
npm run dev

# Frontend (in a separate terminal)
cd ../frontend
npm install
npm run start
```

## Build for production
Backend:
```bash
cd backend
npm run build
NODE_ENV=production node dist/index.js
```
Frontend:
```bash
cd frontend
npm run build
# then serve build with your chosen static server
```

