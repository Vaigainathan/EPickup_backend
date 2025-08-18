#!/bin/bash

# EPickup Backend Deployment Script for Render
# This script automates the deployment process to Render platform

set -e  # Exit on any error

echo "🚀 EPickup Backend Deployment Script"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the backend directory"
    exit 1
fi

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    print_warning ".env.production file not found!"
    print_status "Creating .env.production from template..."
    if [ -f ".env.production.template" ]; then
        cp .env.production.template .env.production
        print_warning "Please edit .env.production with your actual values before deploying!"
        print_status "You can now edit .env.production and run this script again"
        exit 1
    else
        print_error ".env.production.template not found. Please create .env.production manually"
        exit 1
    fi
fi

# Validate environment variables
print_status "Validating environment configuration..."
npm run validate:config

if [ $? -eq 0 ]; then
    print_success "Environment configuration validated successfully"
else
    print_error "Environment configuration validation failed"
    exit 1
fi

# Run tests
print_status "Running tests to ensure code quality..."
npm run test:all

if [ $? -eq 0 ]; then
    print_success "All tests passed successfully"
else
    print_warning "Some tests failed. Continue with deployment? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        print_status "Deployment cancelled by user"
        exit 1
    fi
fi

# Check if git repository exists
if [ ! -d ".git" ]; then
    print_status "Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit for deployment"
    print_success "Git repository initialized"
else
    print_status "Git repository already exists"
fi

# Check git status
print_status "Checking git status..."
if [ -n "$(git status --porcelain)" ]; then
    print_warning "Uncommitted changes detected. Commit them? (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        git add .
        git commit -m "Deployment commit - $(date)"
        print_success "Changes committed"
    else
        print_warning "Deploying with uncommitted changes"
    fi
fi

# Check if remote origin exists
if ! git remote get-url origin > /dev/null 2>&1; then
    print_warning "No remote origin configured"
    print_status "Please add your GitHub repository as remote origin:"
    echo "git remote add origin https://github.com/yourusername/your-repo.git"
    echo ""
    print_status "Then push your code:"
    echo "git push -u origin main"
    echo ""
    print_status "After that, you can deploy from the Render dashboard"
    exit 1
fi

# Push to remote repository
print_status "Pushing code to remote repository..."
git push origin main

if [ $? -eq 0 ]; then
    print_success "Code pushed successfully"
else
    print_error "Failed to push code"
    exit 1
fi

print_success "🎉 Deployment preparation completed!"
echo ""
echo "Next steps:"
echo "1. Go to https://dashboard.render.com"
echo "2. Create a new Web Service"
echo "3. Connect your GitHub repository"
echo "4. Select the backend folder"
echo "5. Configure build settings:"
echo "   - Build Command: npm install"
echo "   - Start Command: npm start"
echo "6. Add all environment variables from .env.production"
echo "7. Click 'Create Web Service'"
echo ""
echo "Your app will be available at: https://your-app-name.onrender.com"
echo ""
echo "Health check endpoint: https://your-app-name.onrender.com/health"
echo "Metrics endpoint: https://your-app-name.onrender.com/metrics"
echo ""
print_status "Happy deploying! 🚀"
