const express = require('express');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push, set, get, child, remove, update } = require('firebase/database');
require('dotenv').config();

// Initialize Firebase
const firebaseConfig = {
  databaseURL: process.env.FIREBASE_DATABASE_URL
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Initialize Express
const expressApp = express();
expressApp.use(express.json());

// Telegram Bot Token
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Helper function to generate verification code
function generateVerificationCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper function to send Telegram messages with inline keyboard
async function sendTelegramMessage(chatId, text, keyboard = null) {
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    
    if (keyboard) {
      payload.reply_markup = {
        inline_keyboard: keyboard
      };
    }
    
    const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
    return response.data;
  } catch (error) {
    console.error('Send message error:', error.response?.data || error.message);
    throw error;
  }
}

// Helper function to download and process image from Telegram
async function processTelegramImage(fileId) {
  try {
    // Get file path from Telegram
    const fileResponse = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
    const filePath = fileResponse.data.result.file_path;
    
    // Download the image
    const imageUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer'
    });
    
    // Convert to base64
    const base64Image = Buffer.from(imageResponse.data).toString('base64');
    
    // Determine content type from file extension
    let contentType = 'image/jpeg'; // Default
    if (filePath.endsWith('.png')) {
      contentType = 'image/png';
    } else if (filePath.endsWith('.gif')) {
      contentType = 'image/gif';
    } else if (filePath.endsWith('.webp')) {
      contentType = 'image/webp';
    }
    
    // Return data URI format compatible with the website
    return `data:${contentType};base64,${base64Image}`;
  } catch (error) {
    console.error('Error processing Telegram image:', error);
    throw error;
  }
}

// Handle Telegram updates
expressApp.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text;
      
      // Add comprehensive logging for debugging
      console.log('Received message:', JSON.stringify(message, null, 2));
      
      // Add safety check for user ID with more detailed logging
      let from;
      if (message.from && message.from.id) {
        from = message.from.id.toString();
        console.log('User ID extracted:', from);
      } else {
        console.error('User ID is missing in the message:', JSON.stringify(message));
        try {
          await sendTelegramMessage(chatId, '❌ An error occurred: Unable to identify your account. Please try again.');
        } catch (err) {
          console.error('Error sending message to user:', err);
        }
        return res.sendStatus(200);
      }
      
      // Handle photo messages
      if (message.photo) {
        console.log('Handling photo message for user:', from);
        await handlePhotoMessage(from, chatId, message.photo);
        return res.sendStatus(200);
      }
      
      // Handle commands
      if (text === '/start' || text.toLowerCase() === 'menu') {
        const keyboard = [
          [
            { text: '🔍 Report Lost Item', callback_data: 'report_lost' },
            { text: '🎁 Report Found Item', callback_data: 'report_found' }
          ],
          [
            { text: '🔎 Search for Items', callback_data: 'search' },
            { text: '📞 Contact Developer', callback_data: 'contact' }
          ],
          [
            { text: '📋 My Reports', callback_data: 'my_reports' }
          ]
        ];
        
        // Clear any existing user state when showing menu
        await remove(ref(db, `users/${from}`));
        
        await sendTelegramMessage(chatId, `📋 *Welcome to Kwasu Lost And Found Bot!*\n_v0.2 with Image Support - Designed & Developed by_ Rugged of ICT.\n\nTo proceed with, Select what you are here for from the menu:`, keyboard);
      } 
      else {
        await handleTelegramResponse(from, text, chatId);
      }
    }
    else if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      
      // Add safety check for user ID with more detailed logging
      let from;
      if (callbackQuery.from && callbackQuery.from.id) {
        from = callbackQuery.from.id.toString();
        console.log('User ID extracted from callback:', from);
      } else {
        console.error('User ID is missing in the callback query:', JSON.stringify(callbackQuery));
        try {
          await sendTelegramMessage(chatId, '❌ An error occurred: Unable to identify your account. Please try again.');
        } catch (err) {
          console.error('Error sending message to user:', err);
        }
        return res.sendStatus(200);
      }
      
      // Handle callback queries
      if (data === 'menu') {
        const keyboard = [
          [
            { text: '🔍 Report Lost Item', callback_data: 'report_lost' },
            { text: '🎁 Report Found Item', callback_data: 'report_found' }
          ],
          [
            { text: '🔎 Search for Items', callback_data: 'search' },
            { text: '📞 Contact Developer', callback_data: 'contact' }
          ],
          [
            { text: '📋 My Reports', callback_data: 'my_reports' }
          ]
        ];
        
        // Clear any existing user state when showing menu
        await remove(ref(db, `users/${from}`));
        
        await sendTelegramMessage(chatId, `📋 *Welcome to Kwasu Lost And Found Bot!*\n_v0.2 with Image Support - Designed & Developed by_ Rugged of ICT.\n\nTo proceed with, Select what you are here for from the menu:`, keyboard);
      }
      else if (data === 'report_lost') {
        await sendTelegramMessage(chatId, '🔍 *Report Lost Item*\n\nPlease provide the following details:\nITEM, LOCATION, DESCRIPTION\n\nExample: "Water Bottle, Library, Blue with sticker"\n\n💡 *Optional:* You can also send an image of the item after submitting details.');
        await set(ref(db, `users/${from}`), { 
          action: 'report_lost',
          step: 'awaiting_details'
        });
      }
      else if (data === 'report_found') {
        await sendTelegramMessage(chatId, '🎁 *Report Found Item*\n\n📷 *Step 1:* Please send an image of the found item.\n\nAfter the image is received, you will be asked for the details.');
        await set(ref(db, `users/${from}`), { 
          action: 'report_found',
          step: 'awaiting_image'
        });
      }
      else if (data === 'search') {
        await sendTelegramMessage(chatId, '🔎 *Search for my lost Item*\n\nPlease reply with a keyword to search:\n\nExample: "water", "keys", "bag"\n\n💡 *Tip:* Items with images are marked with 📷');
        await set(ref(db, `users/${from}`), { action: 'search' });
      }
      else if (data === 'contact') {
        await sendTelegramMessage(chatId, `📞 *Contact Developer*\n\nFor any issues or support, please contact the developer:\n\n*WhatsApp:* 09038323588\n\n*Note:* Please go straight to the point in your DM to avoid late response. Be direct and clear about your issue or inquiry.`);
      }
      else if (data === 'my_reports') {
        await showUserReports(from, chatId);
      }
      else if (data.startsWith('view_')) {
        const reportId = data.replace('view_', '');
        await showReportDetails(from, chatId, reportId);
      }
      else if (data.startsWith('mark_claimed_')) {
        const reportId = data.replace('mark_claimed_', '');
        await showClaimVerification(from, chatId, reportId, 'claimed');
      }
      else if (data.startsWith('mark_recovered_')) {
        const reportId = data.replace('mark_recovered_', '');
        await showClaimVerification(from, chatId, reportId, 'recovered');
      }
      
      // Answer callback query
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id
      });
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram update error:', error);
    res.sendStatus(500);
  }
});

// Handle photo messages
async function handlePhotoMessage(from, chatId, photo) {
  try {
    // Add comprehensive logging for debugging
    console.log('handlePhotoMessage called with from:', from, 'chatId:', chatId);
    
    // Add safety check for user ID
    if (!from || from === 'undefined' || from === null) {
      console.error('Invalid user ID in handlePhotoMessage:', from);
      try {
        await sendTelegramMessage(chatId, '❌ An error occurred: Unable to identify your account. Please try again.');
      } catch (err) {
        console.error('Error sending message to user:', err);
      }
      return;
    }
    
    console.log('Getting user state for:', from);
    
    // Get user state
    const userSnapshot = await get(child(ref(db, `users/${from}`)));
    const user = userSnapshot.val();
    
    if (!user) {
      console.error('User state not found for:', from);
      await sendTelegramMessage(chatId, '❌ Please start by selecting "Report Found Item" from the menu. Images are only required for found items.');
      return;
    }
    
    if (user.action !== 'report_found' || user.step !== 'awaiting_image') {
      console.error('User in wrong state:', user);
      await sendTelegramMessage(chatId, '❌ Please start by selecting "Report Found Item" from the menu. Images are only required for found items.');
      return;
    }
    
    // Get the highest resolution photo (last in array)
    const photoFile = photo[photo.length - 1];
    const fileId = photoFile.file_id;
    
    try {
      // Process the image
      const imageUrl = await processTelegramImage(fileId);
      
      // Update user state with the image
      await set(ref(db, `users/${from}`), {
        action: 'report_found',
        step: 'awaiting_details',
        image_url: imageUrl
      });
      
      await sendTelegramMessage(chatId, '✅ Image received! Now, please provide the item details in this format:\n\nITEM, LOCATION, YOUR_PHONE_NUMBER\n\nExample: "Keys, Cafeteria, 08012345678"');
    } catch (error) {
      console.error('Error processing image:', error);
      await sendTelegramMessage(chatId, '❌ Error processing image. Please try again.');
    }
  } catch (error) {
    console.error('Handle photo message error:', error);
    try {
      await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.');
    } catch (err) {
      console.error('Error sending message to user:', err);
    }
  }
}

async function showReportDetails(from, chatId, reportId) {
  try {
    const reportRef = ref(db, `reports/${reportId}`);
    const reportSnapshot = await get(reportRef);
    const report = reportSnapshot.val();
    
    if (!report) {
      const keyboard = [
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.', keyboard);
      return;
    }
    
    if (report.reporter !== from) {
      const keyboard = [
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, '❌ You are not authorized to view this report.', keyboard);
      return;
    }
    
    let message = `📋 *Report Details*\n\n`;
    message += `📦 *Item:* ${report.item}\n`;
    message += `📍 *Location:* ${report.location}\n`;
    message += `🔐 *Verification Code:* ${report.verification_code}\n`;
    
    if (report.type === 'lost') {
      message += `📝 *Description:* ${report.description}\n`;
      message += `📊 *Status:* ${report.recovered ? '✅ Recovered' : '❌ Not Recovered'}\n`;
      
      if (!report.recovered) {
        const keyboard = [
          [
            { text: '✅ Mark as Recovered', callback_data: `mark_recovered_${reportId}` }
          ],
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, message, keyboard);
        return;
      }
    } else {
      message += `📞 *Contact:* ${report.contact_phone}\n`;
      message += `📝 *Description:* ${report.description}\n`;
      message += `📊 *Status:* ${report.claimed ? '✅ Claimed' : '❌ Not Claimed'}\n`;
      
      if (report.image_url) {
        message += `📷 *Image:* Attached\n`;
      }
      
      if (!report.claimed) {
        const keyboard = [
          [
            { text: '✅ Mark as Claimed', callback_data: `mark_claimed_${reportId}` }
          ],
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, message, keyboard);
        return;
      }
    }
    
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    
    await sendTelegramMessage(chatId, message, keyboard);
  } catch (error) {
    console.error('Show report details error:', error);
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    await sendTelegramMessage(chatId, '❌ An error occurred while fetching report details. Please try again.', keyboard);
  }
}

async function showUserReports(from, chatId) {
  try {
    const reportsRef = ref(db, 'reports');
    const reportsSnapshot = await get(reportsRef);
    const reports = reportsSnapshot.val();
    
    if (!reports || Object.keys(reports).length === 0) {
      const keyboard = [
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, '❌ You have not reported any items yet.\n\nUse the menu to report a lost or found item.', keyboard);
      return;
    }
    
    let response = `📋 *Your Reports*\n\n`;
    let hasReports = false;
    let reportButtons = [];
    
    Object.entries(reports).forEach(([key, report]) => {
      if (report.reporter === from) {
        hasReports = true;
        const date = new Date(report.timestamp).toLocaleString();
        
        if (report.type === 'lost') {
          const status = report.recovered ? '✅ Recovered' : '❌ Not Recovered';
          response += `🔍 *Lost Item: ${report.item}*\n`;
          response += `📍 Location: ${report.location}\n`;
          response += `📅 Reported: ${date}\n`;
          response += `📊 Status: ${status}\n\n`;
          
          if (!report.recovered) {
            reportButtons.push([{ text: `🔍 ${report.item}`, callback_data: `view_${key}` }]);
          }
        } else {
          const status = report.claimed ? '✅ Claimed' : '❌ Not Claimed';
          response += `🎁 *Found Item: ${report.item}*`;
          if (report.image_url) {
            response += ` 📷`;
          }
          response += `\n📍 Location: ${report.location}\n`;
          response += `📅 Reported: ${date}\n`;
          response += `📊 Status: ${status}\n\n`;
          
          if (!report.claimed) {
            reportButtons.push([{ text: `🎁 ${report.item}`, callback_data: `view_${key}` }]);
          }
        }
      }
    });
    
    if (!hasReports) {
      response = '❌ You have not reported any items yet.\n\nUse the menu to report a lost or found item.';
    } else if (reportButtons.length > 0) {
      // Add action buttons for each report
      const keyboard = [
        ...reportButtons,
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, response, keyboard);
      return;
    }
    
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    
    await sendTelegramMessage(chatId, response, keyboard);
  } catch (error) {
    console.error('Show user reports error:', error);
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    await sendTelegramMessage(chatId, '❌ An error occurred while fetching your reports. Please try again.', keyboard);
  }
}

async function showClaimVerification(from, chatId, reportId, statusType) {
  try {
    const reportRef = ref(db, `reports/${reportId}`);
    const reportSnapshot = await get(reportRef);
    const report = reportSnapshot.val();
    
    if (!report) {
      const keyboard = [
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.', keyboard);
      return;
    }
    
    if (report.reporter !== from) {
      const keyboard = [
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, '❌ You are not authorized to modify this report.', keyboard);
      return;
    }
    
    let message = `🔐 *Verification Required*\n\n`;
    message += `To mark this item as ${statusType === 'claimed' ? 'claimed' : 'recovered'}, please enter your verification code.\n\n`;
    
    if (statusType === 'claimed') {
      message += `📦 *Item:* ${report.item}\n`;
      message += `📍 *Location:* ${report.location}\n`;
    } else {
      message += `📦 *Item:* ${report.item}\n`;
      message += `📍 *Location:* ${report.location}\n`;
    }
    
    message += `\n⚠️ *Important:* This verification code was provided when you first reported the item. If you don't have it, please contact the developer at 09038323588.\n\n`;
    message += `Please reply with your 6-character verification code:`;
    
    await set(ref(db, `users/${from}`), { 
      action: 'verify_code',
      reportId: reportId,
      statusType: statusType
    });
    
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    await sendTelegramMessage(chatId, message, keyboard);
  } catch (error) {
    console.error('Show claim verification error:', error);
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.', keyboard);
  }
}

async function handleTelegramResponse(from, msg, chatId) {
  try {
    // Add safety check for user ID
    if (!from || from === 'undefined' || from === null) {
      console.error('Invalid user ID in handleTelegramResponse:', from);
      try {
        await sendTelegramMessage(chatId, '❌ An error occurred: Unable to identify your account. Please try again.');
      } catch (err) {
        console.error('Error sending message to user:', err);
      }
      return;
    }
    
    // Get user state
    const userRef = ref(db, `users/${from}`);
    const userSnapshot = await get(userRef);
    const user = userSnapshot.val();
    
    if (!user) {
      const keyboard = [
        [
          { text: '🔍 Report Lost Item', callback_data: 'report_lost' },
          { text: '🎁 Report Found Item', callback_data: 'report_found' }
        ],
        [
          { text: '🔎 Search for Items', callback_data: 'search' },
          { text: '📞 Contact Developer', callback_data: 'contact' }
        ]
      ];
      
      await sendTelegramMessage(chatId, '❓ Invalid command. Please select an option from the menu:', keyboard);
      return;
    }

    // Handle verification code input
    if (user.action === 'verify_code') {
      const verificationCode = msg.trim().toUpperCase();
      
      if (verificationCode.length !== 6) {
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, '❌ Invalid verification code format. Please enter the 6-character code provided when you reported the item.', keyboard);
        return;
      }
      
      // Get the report
      const reportRef = ref(db, `reports/${user.reportId}`);
      const reportSnapshot = await get(reportRef);
      const report = reportSnapshot.val();
      
      if (!report) {
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.', keyboard);
        return;
      }
      
      if (report.verification_code !== verificationCode) {
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, '❌ Incorrect verification code. Please try again or contact the developer if you forgot your code.', keyboard);
        return;
      }
      
      // Update the report status
      const updateData = {};
      if (user.statusType === 'claimed') {
        updateData.claimed = true;
        updateData.claimed_at = new Date().toISOString();
      } else {
        updateData.recovered = true;
        updateData.recovered_at = new Date().toISOString();
      }
      
      // Perform the update
      await update(reportRef, updateData);
      
      // Send confirmation - SIMPLIFIED VERSION
      try {
        const successMessage = `✅ Item Successfully Marked as ${user.statusType === 'claimed' ? 'Claimed' : 'Recovered'}!\n\nItem: ${report.item}\nLocation: ${report.location}\n\nThank you for using this platform!`;
        
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        
        await sendTelegramMessage(chatId, successMessage, keyboard);
      } catch (error) {
        console.error('Error sending success message:', error);
        // Try with a simpler message
        const simpleMessage = `Item marked as ${user.statusType === 'claimed' ? 'claimed' : 'recovered'} successfully!`;
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, simpleMessage, keyboard);
      }
      
      // Clear user state
      await remove(ref(db, `users/${from}`));
    }
    // Handle report submission
    else if (user.action === 'report_lost' || user.action === 'report_found') {
      // Check if user is trying to send text before an image for found items
      if (user.action === 'report_found' && user.step === 'awaiting_image') {
        await sendTelegramMessage(chatId, '⚠️ An image is required for found items. Please send an image of the item first.');
        return;
      }

      // User is sending details after the image (for found items) or directly (for lost items)
      if (user.action === 'report_found' && user.step === 'awaiting_details') {
        // IMPORTANT: Check if the image was actually saved
        if (!user.image_url) {
          console.error(`Image data missing for user ${from} during found item report.`);
          await sendTelegramMessage(chatId, '❌ An error occurred. The image was not saved correctly. Please start over by selecting "Report Found Item" from the menu.');
          await remove(ref(db, `users/${from}`)); // Reset user state
          return;
        }
      }

      const parts = msg.split(',');
      if (parts.length < 3) {
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, `⚠️ Format error. Please use: ${user.action === 'report_lost' ? 'ITEM, LOCATION, DESCRIPTION' : 'ITEM, LOCATION, YOUR_PHONE_NUMBER'}`, keyboard);
        return;
      }
      
      const item = parts[0].trim();
      const location = parts[1].trim();
      const thirdPart = parts[2].trim();
      
      // Generate verification code
      const verificationCode = generateVerificationCode();
      
      let reportData = {
        type: user.action.replace('report_', ''),
        item,
        location,
        reporter: from,
        verification_code: verificationCode,
        timestamp: new Date().toISOString()
      };
      
      // Add the image if it was uploaded (from the 'image_url' field)
      if (user.image_url) {
        reportData.image_url = user.image_url;
      }
      
      if (user.action === 'report_lost') {
        reportData.description = parts.slice(2).join(',').trim();
        reportData.recovered = false;
      } else {
        reportData.contact_phone = thirdPart;
        reportData.description = parts.slice(3).join(',').trim() || 'No description';
        reportData.claimed = false;
      }
      
      // Save to Firebase
      const reportsRef = ref(db, 'reports');
      const newReportRef = push(reportsRef);
      await set(newReportRef, reportData);
      
      // Get the ID of the newly created report
      const reportsSnapshot = await get(reportsRef);
      const reports = reportsSnapshot.val();
      let reportId = null;
      
      for (const key in reports) {
        if (reports[key].verification_code === verificationCode && 
            reports[key].item === item && 
            reports[key].location === location && 
            reports[key].timestamp === reportData.timestamp) {
          reportId = key;
          break;
        }
      }

      // Send confirmation
      if (user.action === 'report_lost') {
        // Enhanced confirmation for lost items
        let confirmationMsg = `✅ Lost Item Reported Successfully!\n\nItem: ${item}\nLocation: ${location}\nDescription: ${reportData.description}\nVerification Code: ${verificationCode}\n\nSave this code - you'll need it to mark your item as recovered.`;
        
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        
        await sendTelegramMessage(chatId, confirmationMsg, keyboard);
      } else {
        // Confirmation with safety warning for found items
        let confirmationMsg = `✅ Found Item Reported Successfully!\n\nItem: ${item}\nLocation: ${location}\nYour Phone: ${reportData.contact_phone}\nDescription: ${reportData.description}\nVerification Code: ${verificationCode}\n\nSave this code - you'll need it to mark the item as claimed.`;
        
        if (reportData.image_url) {
          confirmationMsg += `\n\n📷 Image: Attached`;
        }
        
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        
        await sendTelegramMessage(chatId, confirmationMsg, keyboard);
      }
      
      // Clear user state
      await remove(ref(db, `users/${from}`));
    }
    
    // Handle search
    else if (user.action === 'search') {
      const reportsRef = ref(db, 'reports');
      const reportsSnapshot = await get(reportsRef);
      const reports = reportsSnapshot.val();
      
      if (!reports || Object.keys(reports).length === 0) {
        const keyboard = [
          [
            { text: '🔙 Menu', callback_data: 'menu' }
          ]
        ];
        await sendTelegramMessage(chatId, '❌ No items found in the database.', keyboard);
        return;
      }

      let response = `🔎 Search Results for "${msg}":\n\n`;
      let foundLost = false;
      let foundFound = false;
      let itemButtons = [];
      
      // Separate lost and found items
      Object.entries(reports).forEach(([key, report]) => {
        const searchText = `${report.item} ${report.location} ${report.description}`.toLowerCase();
        if (searchText.includes(msg.toLowerCase())) {
          if (report.type === 'lost') {
            foundLost = true;
            const status = report.recovered ? '✅ Recovered' : '❌ Not Recovered';
            response += `${itemButtons.length + 1}. 🔍 ${report.item}\n`;
            response += `Location: ${report.location}\n`;
            response += `Status: ${status}\n\n`;
            
            if (!report.recovered) {
              itemButtons.push([{ text: `${itemButtons.length + 1}. ${report.item}`, callback_data: `view_${key}` }]);
            }
          } else {
            foundFound = true;
            const status = report.claimed ? '✅ Claimed' : '❌ Not Claimed';
            response += `${itemButtons.length + 1}. 🎁 ${report.item}`;
            if (report.image_url) {
              response += ` 📷`;
            }
            response += `\nLocation: ${report.location}\n`;
            response += `Contact: ${report.contact_phone}\n`;
            response += `Status: ${status}\n\n`;
            
            if (!report.claimed) {
              itemButtons.push([{ text: `${itemButtons.length + 1}. ${report.item}`, callback_data: `view_${key}` }]);
            }
          }
        }
      });
      
      if (!foundLost && !foundFound) {
        response += `❌ No items found matching "${msg}".\nPlease try different keywords.`;
      }
      
      const keyboard = [
        ...itemButtons,
        [
          { text: '🔙 Menu', callback_data: 'menu' }
        ]
      ];
      
      await sendTelegramMessage(chatId, response, keyboard);
      await remove(ref(db, `users/${from}`));
    }
  } catch (error) {
    console.error('Handle response error:', error);
    const keyboard = [
      [
        { text: '🔙 Menu', callback_data: 'menu' }
      ]
    ];
    await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.', keyboard);
  }
}

// Helper function to find matching found items
async function findMatchingFoundItems(searchItem) {
  try {
    const reportsRef = ref(db, 'reports');
    const reportsSnapshot = await get(reportsRef);
    const reports = reportsSnapshot.val();
    
    if (!reports) return [];
    
    const searchKeywords = searchItem.toLowerCase().split(' ');
    const matchingItems = [];
    
    Object.entries(reports).forEach(([key, report]) => {
      if (report.type === 'found') {
        const reportText = `${report.item} ${report.description}`.toLowerCase();
        const matchScore = searchKeywords.reduce((score, keyword) => {
          return score + (reportText.includes(keyword) ? 1 : 0);
        }, 0);
        
        // Bonus points for having an image
        if (report.image_url) {
          matchScore += 2;
        }
        
        if (matchScore > 0) {
          matchingItems.push({...report, matchScore});
        }
      }
    });
    
    // Sort by match score (highest first)
    return matchingItems.sort((a, b) => b.matchScore - a.matchScore);
  } catch (error) {
    console.error('Error finding matching items:', error);
    return [];
  }
}

// Set webhook
async function setWebhook() {
  try {
    const url = `https://kwasu-telegram-bot.onrender.com/webhook/${TELEGRAM_TOKEN}`;
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
      url: url
    });
    console.log('Webhook set successfully');
  } catch (error) {
    console.error('Set webhook error:', error);
  }
}

const PORT = process.env.PORT || 3000;
expressApp.listen(PORT, () => {
  console.log('Telegram bot running!');
  setWebhook();
});
