const { getFirestore } = require('../services/firebase');

const db = getFirestore();

/**
 * Migration script for FAQ and Support system
 */
async function migrateFAQAndSupport() {
  console.log('🔄 Starting FAQ and Support migration...');

  try {
    // Create FAQ categories
    await createFAQCategories();
    
    // Create sample FAQs
    await createSampleFAQs();
    
    // Create contact information
    await createContactInfo();
    
    // Create support settings
    await createSupportSettings();
    
    console.log('✅ FAQ and Support migration completed successfully');
  } catch (error) {
    console.error('❌ FAQ and Support migration failed:', error);
    throw error;
  }
}

async function createFAQCategories() {
  console.log('📂 Creating FAQ categories...');
  
  const categories = [
    {
      id: 'general',
      name: 'General',
      description: 'General questions about EPickup',
      order: 1,
      isActive: true,
      icon: 'help-circle',
      color: '#007AFF'
    },
    {
      id: 'booking',
      name: 'Booking & Delivery',
      description: 'Questions about booking and delivery process',
      order: 2,
      isActive: true,
      icon: 'car',
      color: '#34C759'
    },
    {
      id: 'payment',
      name: 'Payment & Billing',
      description: 'Payment methods and billing questions',
      order: 3,
      isActive: true,
      icon: 'card',
      color: '#FF9500'
    },
    {
      id: 'account',
      name: 'Account & Profile',
      description: 'Account management and profile settings',
      order: 4,
      isActive: true,
      icon: 'person',
      color: '#AF52DE'
    },
    {
      id: 'technical',
      name: 'Technical Support',
      description: 'App technical issues and troubleshooting',
      order: 5,
      isActive: true,
      icon: 'settings',
      color: '#FF3B30'
    },
    {
      id: 'safety',
      name: 'Safety & Security',
      description: 'Safety measures and security features',
      order: 6,
      isActive: true,
      icon: 'shield-checkmark',
      color: '#5856D6'
    }
  ];

  for (const category of categories) {
    await db.collection('faqCategories').doc(category.id).set({
      ...category,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  console.log(`✅ Created ${categories.length} FAQ categories`);
}

async function createSampleFAQs() {
  console.log('📝 Creating sample FAQs...');
  
  const faqs = [
    // General FAQs
    {
      question: 'What is EPickup?',
      answer: 'EPickup is a delivery service app that connects customers with drivers for fast and reliable package delivery. We offer pickup and drop-off services for various types of goods with real-time tracking and secure payment options.',
      category: 'general',
      order: 1,
      tags: ['delivery', 'service', 'app'],
      isActive: true
    },
    {
      question: 'How does EPickup work?',
      answer: 'EPickup works in 4 simple steps: 1) Open the app and set your pickup location, 2) Enter your destination address, 3) Select vehicle type and package weight, 4) Choose payment method and confirm your booking. A driver will be assigned and you can track your delivery in real-time.',
      category: 'general',
      order: 2,
      tags: ['how to', 'process', 'steps'],
      isActive: true
    },
    {
      question: 'What areas does EPickup serve?',
      answer: 'EPickup currently serves major cities across India including Bangalore, Mumbai, Delhi, Chennai, Hyderabad, and Pune. We are continuously expanding our service areas. Check the app for availability in your location.',
      category: 'general',
      order: 3,
      tags: ['coverage', 'cities', 'locations'],
      isActive: true
    },

    // Booking & Delivery FAQs
    {
      question: 'How to book a delivery?',
      answer: 'To book a delivery: 1) Open the app and set your pickup location, 2) Enter your destination address, 3) Select vehicle type and package weight, 4) Choose payment method, 5) Review fare and confirm your booking. You\'ll receive a booking confirmation with tracking details.',
      category: 'booking',
      order: 1,
      tags: ['booking', 'delivery', 'how to'],
      isActive: true
    },
    {
      question: 'How to track my delivery?',
      answer: 'Once your booking is confirmed and a driver is assigned, you can track your delivery in real-time through the app. The driver\'s location and estimated arrival time will be displayed on the map. You\'ll also receive push notifications for status updates.',
      category: 'booking',
      order: 2,
      tags: ['tracking', 'real-time', 'location'],
      isActive: true
    },
    {
      question: 'How long does delivery take?',
      answer: 'Delivery time depends on distance, traffic conditions, and package size. Local deliveries typically take 30-60 minutes, while longer distances may take 2-4 hours. The app shows estimated delivery time before booking confirmation.',
      category: 'booking',
      order: 3,
      tags: ['time', 'duration', 'estimate'],
      isActive: true
    },
    {
      question: 'Can I cancel my booking?',
      answer: 'Yes, you can cancel your booking before the driver arrives at your pickup location. Go to your active booking and tap the "Cancel Booking" button. Note that cancellation fees may apply depending on the cancellation time.',
      category: 'booking',
      order: 4,
      tags: ['cancellation', 'cancel', 'fees'],
      isActive: true
    },

    // Payment FAQs
    {
      question: 'What payment methods are accepted?',
      answer: 'We accept multiple payment methods including Cash on Delivery, UPI, Credit/Debit Cards, and Net Banking. You can choose your preferred payment method during booking. All online payments are secured with industry-standard encryption.',
      category: 'payment',
      order: 1,
      tags: ['payment', 'methods', 'cash', 'upi', 'card'],
      isActive: true
    },
    {
      question: 'How are delivery charges calculated?',
      answer: 'Delivery charges are calculated based on distance, vehicle type, package weight, and current demand. The exact fare is shown before you confirm your booking. We offer transparent pricing with no hidden charges.',
      category: 'payment',
      order: 2,
      tags: ['charges', 'fare', 'pricing', 'calculation'],
      isActive: true
    },
    {
      question: 'Can I get a refund?',
      answer: 'Refunds are processed according to our refund policy. If your delivery is cancelled by us or if there\'s a service issue, you\'ll receive a full refund. For customer cancellations, refunds depend on the cancellation time and may incur fees.',
      category: 'payment',
      order: 3,
      tags: ['refund', 'money back', 'cancellation'],
      isActive: true
    },

    // Account FAQs
    {
      question: 'How do I create an account?',
      answer: 'Creating an account is simple: 1) Download the EPickup app, 2) Enter your phone number, 3) Verify with OTP, 4) Complete your profile with name and email. You can also add profile picture and saved addresses for convenience.',
      category: 'account',
      order: 1,
      tags: ['signup', 'register', 'account'],
      isActive: true
    },
    {
      question: 'How to update my profile?',
      answer: 'To update your profile: Go to Account tab → Edit Profile. You can update your name, email, phone number, and profile picture. Changes are saved automatically and reflected immediately.',
      category: 'account',
      order: 2,
      tags: ['profile', 'update', 'edit'],
      isActive: true
    },
    {
      question: 'How to save delivery addresses?',
      answer: 'You can save frequently used addresses: Go to Account tab → Saved Addresses → Add New Address. Enter address details and choose type (Home/Work/Other). Saved addresses appear as quick options during booking.',
      category: 'account',
      order: 3,
      tags: ['addresses', 'save', 'frequent'],
      isActive: true
    },

    // Technical FAQs
    {
      question: 'The app is not working properly',
      answer: 'If the app is not working: 1) Check your internet connection, 2) Restart the app, 3) Clear app cache and data, 4) Update to the latest version, 5) If issues persist, contact our technical support team.',
      category: 'technical',
      order: 1,
      tags: ['app', 'issues', 'troubleshooting'],
      isActive: true
    },
    {
      question: 'I can\'t receive OTP',
      answer: 'If you\'re not receiving OTP: 1) Check if your phone number is correct, 2) Ensure good network coverage, 3) Check spam folder for SMS, 4) Wait 2-3 minutes before requesting new OTP, 5) Contact support if issue persists.',
      category: 'technical',
      order: 2,
      tags: ['otp', 'verification', 'sms'],
      isActive: true
    },
    {
      question: 'Location services not working',
      answer: 'For location issues: 1) Enable location permissions in app settings, 2) Turn on GPS/Location services, 3) Allow location access when prompted, 4) Restart the app, 5) If problems continue, contact technical support.',
      category: 'technical',
      order: 3,
      tags: ['location', 'gps', 'permissions'],
      isActive: true
    },

    // Safety FAQs
    {
      question: 'Is my package safe during delivery?',
      answer: 'Yes, your package is safe. All our drivers are verified and trained. We provide real-time tracking, delivery confirmation, and insurance coverage for packages. You can also rate your delivery experience after completion.',
      category: 'safety',
      order: 1,
      tags: ['safety', 'security', 'insurance'],
      isActive: true
    },
    {
      question: 'What if my package is damaged?',
      answer: 'If your package arrives damaged: 1) Take photos immediately, 2) Don\'t accept the delivery, 3) Contact our support team, 4) We will investigate and provide appropriate compensation as per our terms of service.',
      category: 'safety',
      order: 2,
      tags: ['damaged', 'compensation', 'insurance'],
      isActive: true
    },
    {
      question: 'How do I report a safety concern?',
      answer: 'For safety concerns: 1) Use the emergency button in the app, 2) Call our 24/7 emergency support, 3) Contact local authorities if needed, 4) Report the incident through the app. We take all safety reports seriously.',
      category: 'safety',
      order: 3,
      tags: ['emergency', 'safety', 'report'],
      isActive: true
    }
  ];

  for (const faq of faqs) {
    await db.collection('faqs').add({
      ...faq,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      lastUpdated: new Date()
    });
  }

  console.log(`✅ Created ${faqs.length} sample FAQs`);
}

async function createContactInfo() {
  console.log('📞 Creating contact information...');
  
  const contactInfo = {
    phone: '+91-1800-123-4567',
    email: 'support@epickup.com',
    whatsapp: '+91-98765-43210',
    address: 'EPickup Support, Bangalore, Karnataka, India',
    workingHours: '24/7',
    emergency: '+91-98765-43211',
    socialMedia: {
      facebook: 'https://facebook.com/epickup',
      twitter: 'https://twitter.com/epickup',
      instagram: 'https://instagram.com/epickup',
      linkedin: 'https://linkedin.com/company/epickup'
    },
    departments: {
      general: {
        phone: '+91-1800-123-4567',
        email: 'support@epickup.com',
        hours: '6:00 AM - 10:00 PM',
        description: 'General inquiries and support'
      },
      technical: {
        phone: '+91-1800-123-4568',
        email: 'tech@epickup.com',
        hours: '8:00 AM - 8:00 PM',
        description: 'Technical issues and app support'
      },
      billing: {
        phone: '+91-1800-123-4569',
        email: 'billing@epickup.com',
        hours: '9:00 AM - 6:00 PM',
        description: 'Payment and billing inquiries'
      },
      emergency: {
        phone: '+91-98765-43211',
        email: 'emergency@epickup.com',
        hours: '24/7',
        description: 'Emergency situations and safety concerns'
      }
    },
    createdAt: new Date(),
    lastUpdated: new Date()
  };

  await db.collection('appSettings').doc('contactInfo').set(contactInfo);
  console.log('✅ Contact information created');
}

async function createSupportSettings() {
  console.log('⚙️ Creating support settings...');
  
  const supportSettings = {
    autoResponseEnabled: true,
    autoResponseMessage: 'Thank you for contacting EPickup support. We have received your message and will respond within 2 hours.',
    maxTicketAge: 30, // days
    escalationTime: 24, // hours
    workingHours: {
      start: '06:00',
      end: '22:00',
      timezone: 'Asia/Kolkata'
    },
    emergencyHours: {
      start: '00:00',
      end: '23:59',
      timezone: 'Asia/Kolkata'
    },
    categories: ['technical', 'billing', 'delivery', 'account', 'other'],
    priorities: ['low', 'medium', 'high', 'urgent'],
    statuses: ['open', 'in_progress', 'resolved', 'closed'],
    createdAt: new Date(),
    lastUpdated: new Date()
  };

  await db.collection('appSettings').doc('supportSettings').set(supportSettings);
  console.log('✅ Support settings created');
}

// Export for use in other scripts
module.exports = {
  migrateFAQAndSupport,
  createFAQCategories,
  createSampleFAQs,
  createContactInfo,
  createSupportSettings
};

// Run migration if called directly
if (require.main === module) {
  migrateFAQAndSupport()
    .then(() => {
      console.log('🎉 FAQ and Support migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 FAQ and Support migration failed:', error);
      process.exit(1);
    });
}
