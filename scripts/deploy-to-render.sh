#!/bin/bash

echo "🚀 EPickup Backend - Render Deployment Script"
echo "=============================================="

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the backend directory"
    exit 1
fi

echo "📋 Pre-deployment checks..."

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "🔧 Initializing Git repository..."
    git init
    git add .
    git commit -m "Initial commit for Render deployment"
    echo "✅ Git repository initialized"
else
    echo "✅ Git repository already exists"
fi

# Check if remote is set
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "⚠️  No remote repository set"
    echo "📝 Please run these commands manually:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/epickup-backend.git"
    echo "   git push -u origin main"
else
    echo "✅ Remote repository configured"
    echo "📤 Pushing to GitHub..."
    git push origin main
fi

echo ""
echo "🎯 Next Steps for Render Deployment:"
echo "====================================="
echo ""
echo "1️⃣  Create GitHub Repository:"
echo "   - Go to https://github.com/new"
echo "   - Name: epickup-backend"
echo "   - Make it public or private"
echo ""
echo "2️⃣  Push to GitHub:"
echo "   git remote add origin https://github.com/YOUR_USERNAME/epickup-backend.git"
echo "   git push -u origin main"
echo ""
echo "3️⃣  Deploy to Render:"
echo "   - Visit https://render.com"
echo "   - Sign up with GitHub"
echo "   - Click 'New +' → 'Web Service'"
echo "   - Connect your epickup-backend repository"
echo ""
echo "4️⃣  Configure Environment Variables:"
echo "   - Copy values from .env.production"
echo "   - Set in Render dashboard"
echo ""
echo "5️⃣  Deploy:"
echo "   - Click 'Create Web Service'"
echo "   - Wait for build (5-10 minutes)"
echo ""
echo "📚 See RENDER_DEPLOYMENT_GUIDE.md for detailed instructions"
echo ""
echo "✅ Your backend is ready for deployment!"
