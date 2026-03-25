# Exit Advisor API Proxy

Simple Node.js backend that proxies Claude API requests to avoid CORS issues.

## 🚀 Quick Deploy to Railway (Free Tier)

### Option 1: Deploy via Railway CLI (Easiest)

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway:**
   ```bash
   railway login
   ```

3. **Deploy:**
   ```bash
   cd backend
   railway init
   railway up
   ```

4. **Get your URL:**
   ```bash
   railway domain
   ```

### Option 2: Deploy via Railway Web Interface

1. Go to https://railway.app/new
2. Click "Deploy from GitHub repo"
3. Connect your GitHub account
4. Push this `backend` folder to a GitHub repo
5. Select the repo in Railway
6. Railway will auto-detect Node.js and deploy
7. Click "Generate Domain" to get your public URL

### Option 3: Deploy to Render (Alternative Free Tier)

1. Go to https://render.com
2. Click "New +" → "Web Service"
3. Connect GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click "Create Web Service"
6. Copy your deployed URL

## 📝 Environment Variables

No environment variables needed! The API key is passed in requests from the frontend.

## 🔧 Local Development

```bash
npm install
npm start
```

Server runs on http://localhost:3000

## 📡 API Endpoints

### Health Check
```
GET /health
```

### Claude API Proxy
```
POST /api/claude
Content-Type: application/json

{
  "apiKey": "sk-ant-api03-...",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "systemPrompt": "You are a helpful assistant..."
}
```

## 🔐 Security Notes

- API key is sent in request body (not stored on server)
- CORS enabled for all origins (restrict in production)
- No data persistence - stateless proxy
- All requests are logged (remove in production)

## 🌐 Update Frontend

After deploying, update your frontend `ClaudeAPI` module:

```javascript
const API_URL = 'https://your-railway-app.railway.app/api/claude';

async sendMessage(userMessage, systemContext = null) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: StateManager.state.apiKey,
      messages: messages,
      systemPrompt: this.buildSystemPrompt(systemContext)
    })
  });
  
  const data = await response.json();
  return data.content[0].text;
}
```

## 💰 Cost

**Railway Free Tier:**
- $5 credit/month
- 500 hours execution time
- More than enough for personal use

**Render Free Tier:**
- 750 hours/month
- Spins down after 15min inactivity
- Slower cold starts

Both are FREE and perfect for this use case!
