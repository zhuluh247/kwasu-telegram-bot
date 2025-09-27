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
    
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
  } catch (error) {
    console.error('Send message error:', error);
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
      const from = message.from.id.toString();

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
        
        await sendTelegramMessage(chatId, `📋 *Welcome to Kwasu Lost And Found Bot!*\n_v0.2 Designed & Developed by_ Rugged of ICT.\n\nTo proceed with, Select what you are here for from the menu:`, keyboard);
      } 
      else {
        await handleTelegramResponse(from, text, chatId);
      }
    }
    else if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      const from = callbackQuery.from.id.toString();
      
      // Handle callback queries
      if (data === 'report_lost') {
        await sendTelegramMessage(chatId, '🔍 *Report Lost Item*\n\nPlease provide the following details:\nITEM, LOCATION, DESCRIPTION\n\nExample: "Water Bottle, Library, Blue with sticker"');
        await set(ref(db, `users/${from}`), { action: 'report_lost' });
      }
      else if (data === 'report_found') {
        await sendTelegramMessage(chatId, '🎁 *Report Found Item*\n\nPlease provide the following details:\nITEM, LOCATION, YOUR_PHONE_NUMBER\n\n⚠️ *Important:* The phone number should be YOUR phone number (the person who found the item) so the owner can contact you.\n\nExample: "Keys, Cafeteria, 08012345678"');
        await set(ref(db, `users/${from}`), { action: 'report_found' });
      }
      else if (data === 'search') {
        await sendTelegramMessage(chatId, '🔎 *Search for my lost Item*\n\nPlease reply with a keyword to search:\n\nExample: "water", "keys", "bag"\n\n💡 *Tip: Keep checking back regularly as new items are reported all the time!*');
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

async function showReportDetails(from, chatId, reportId) {
  try {
    const reportRef = ref(db, `reports/${reportId}`);
    const reportSnapshot = await get(reportRef);
    const report = reportSnapshot.val();
    
    if (!report) {
      await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.');
      return;
    }
    
    if (report.reporter !== from) {
      await sendTelegramMessage(chatId, '❌ You are not authorized to view this report.');
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
            { text: '🔙 Back to My Reports', callback_data: 'my_reports' }
          ]
        ];
        await sendTelegramMessage(chatId, message, keyboard);
        return;
      }
    } else {
      message += `📞 *Contact:* ${report.contact_phone}\n`;
      message += `📝 *Description:* ${report.description}\n`;
      message += `📊 *Status:* ${report.claimed ? '✅ Claimed' : '❌ Not Claimed'}\n`;
      
      if (!report.claimed) {
        const keyboard = [
          [
            { text: '✅ Mark as Claimed', callback_data: `mark_claimed_${reportId}` }
          ],
          [
            { text: '🔙 Back to My Reports', callback_data: 'my_reports' }
          ]
        ];
        await sendTelegramMessage(chatId, message, keyboard);
        return;
      }
    }
    
    const keyboard = [
      [
        { text: '🔙 Back to My Reports', callback_data: 'my_reports' }
      ]
    ];
    
    await sendTelegramMessage(chatId, message, keyboard);
  } catch (error) {
    console.error('Show report details error:', error);
    await sendTelegramMessage(chatId, '❌ An error occurred while fetching report details. Please try again.');
  }
}

async function showUserReports(from, chatId) {
  try {
    const reportsRef = ref(db, 'reports');
    const reportsSnapshot = await get(reportsRef);
    const reports = reportsSnapshot.val();
    
    if (!reports || Object.keys(reports).length === 0) {
      await sendTelegramMessage(chatId, '❌ You have not reported any items yet.\n\nUse the main menu to report a lost or found item.');
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
          response += `🎁 *Found Item: ${report.item}*\n`;
          response += `📍 Location: ${report.location}\n`;
          response += `📅 Reported: ${date}\n`;
          response += `📊 Status: ${status}\n\n`;
          
          if (!report.claimed) {
            reportButtons.push([{ text: `🎁 ${report.item}`, callback_data: `view_${key}` }]);
          }
        }
      }
    });
    
    if (!hasReports) {
      response = '❌ You have not reported any items yet.\n\nUse the main menu to report a lost or found item.';
    } else if (reportButtons.length > 0) {
      // Add action buttons for each report
      const keyboard = [
        ...reportButtons,
        [
          { text: '🔍 Main Menu', callback_data: 'menu' }
        ]
      ];
      await sendTelegramMessage(chatId, response, keyboard);
      return;
    }
    
    const keyboard = [
      [
        { text: '🔍 Main Menu', callback_data: 'menu' }
      ]
    ];
    
    await sendTelegramMessage(chatId, response, keyboard);
  } catch (error) {
    console.error('Show user reports error:', error);
    await sendTelegramMessage(chatId, '❌ An error occurred while fetching your reports. Please try again.');
  }
}

async function showClaimVerification(from, chatId, reportId, statusType) {
  try {
    const reportRef = ref(db, `reports/${reportId}`);
    const reportSnapshot = await get(reportRef);
    const report = reportSnapshot.val();
    
    if (!report) {
      await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.');
      return;
    }
    
    if (report.reporter !== from) {
      await sendTelegramMessage(chatId, '❌ You are not authorized to modify this report.');
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
    
    await sendTelegramMessage(chatId, message);
  } catch (error) {
    console.error('Show claim verification error:', error);
    await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.');
  }
}

async function handleTelegramResponse(from, msg, chatId) {
  try {
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
        await sendTelegramMessage(chatId, '❌ Invalid verification code format. Please enter the 6-character code provided when you reported the item.');
        return;
      }
      
      const reportRef = ref(db, `reports/${user.reportId}`);
      const reportSnapshot = await get(reportRef);
      const report = reportSnapshot.val();
      
      if (!report) {
        await sendTelegramMessage(chatId, '❌ Report not found. It may have been deleted.');
        return;
      }
      
      if (report.verification_code !== verificationCode) {
        await sendTelegramMessage(chatId, '❌ Incorrect verification code. Please try again or contact the developer if you forgot your code.');
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
      
      await update(reportRef, updateData);
      
      // Send confirmation
      const successMessage = `✅ *Item Successfully Marked as ${user.statusType === 'claimed' ? 'Claimed' : 'Recovered'}!*\n\n`;
      successMessage += `📦 *Item:* ${report.item}\n`;
      successMessage += `📍 *Location:* ${report.location}\n\n`;
      
      if (user.statusType === 'claimed') {
        successMessage += `🎉 Thank you for returning the item to its rightful owner! This helps keep our community safe and trustworthy.\n\n`;
        successMessage += `📝 *Note:* The item will be automatically removed from search results after 2 days to keep the database clean.\n\n`;
      } else {
        successMessage += `🎉 We're glad you found your item! This helps us know that the system is working.\n\n`;
        successMessage += `📝 *Note:* The item will be automatically removed from search results after 2 days to keep the database clean.\n\n`;
      }
      
      successMessage += `🙏 *Thank you for using KWASU Lost & Found!*`;
      
      const keyboard = [
        [
          { text: '🔍 Main Menu', callback_data: 'menu' }
        ]
      ];
      
      await sendTelegramMessage(chatId, successMessage, keyboard);
      
      // Clear user state
      await remove(ref(db, `users/${from}`));
    }
    // Handle report submission
    else if (user.action === 'report_lost' || user.action === 'report_found') {
      const parts = msg.split(',');
      if (parts.length < 3) {
        await sendTelegramMessage(chatId, `⚠️ Format error. Please use: ${user.action === 'report_lost' ? 'ITEM, LOCATION, DESCRIPTION' : 'ITEM, LOCATION, YOUR_PHONE_NUMBER'}`);
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
        let confirmationMsg = `✅ *Lost Item Reported Successfully!*\n\n`;
        confirmationMsg += `📦 *Item:* ${item}\n`;
        confirmationMsg += `📍 *Location:* ${location}\n`;
        confirmationMsg += `📝 *Description:* ${reportData.description}\n`;
        confirmationMsg += `🔐 *Verification Code:* ${verificationCode}\n\n`;
        
        // Tips for lost item owner
        confirmationMsg += `💡 *Tips for You (Item Owner):*\n`;
        confirmationMsg += `• Save this verification code - you'll need it to mark your item as recovered\n`;
        confirmationMsg += `• Keep checking back regularly for updates\n`;
        confirmationMsg += `• Spread the word about your lost item\n`;
        confirmationMsg += `• Check locations where you might have lost it\n`;
        confirmationMsg += `• Be specific about unique features when inquiring\n\n`;
        
        confirmationMsg += `🔍 *We're searching for matching found items...*\n\n`;
        
        // Check for matching found items
        const foundItems = await findMatchingFoundItems(item);
        if (foundItems.length > 0) {
          confirmationMsg += `🎉 *Good news!* We found ${foundItems.length} matching item(s) that were reported found:\n\n`;
          foundItems.forEach((item, index) => {
            confirmationMsg += `${index + 1}. *${item.item}*\n`;
            confirmationMsg += `   📍 Location: ${item.location}\n`;
            confirmationMsg += `   📞 Contact: ${item.contact_phone}\n`;
            confirmationMsg += `   📝 ${item.description}\n`;
            confirmationMsg += `   ⏰ ${new Date(item.timestamp).toLocaleString()}\n\n`;
          });
          
          confirmationMsg += `💡 *When contacting:* Please provide details about your item to verify ownership.\n\n`;
        } else {
          confirmationMsg += `😔 *No matching found items yet.*\n\n`;
          confirmationMsg += `🔄 *Please keep checking back regularly as new items are reported every day!*\n\n`;
        }
        
        // Add view details button
        const keyboard = [
          [
            { text: '📋 View Report Details', callback_data: `view_${reportId}` }
          ],
          [
            { text: '🔍 Main Menu', callback_data: 'menu' }
          ]
        ];
        
        confirmationMsg += `🙏 *Thank you for using KWASU Lost & Found Bot!*`;
        await sendTelegramMessage(chatId, confirmationMsg, keyboard);
      } else {
        // Confirmation with safety warning for found items
        let confirmationMsg = `✅ *Found Item Reported Successfully!*\n\n`;
        confirmationMsg += `📦 *Item:* ${item}\n`;
        confirmationMsg += `📍 *Location:* ${location}\n`;
        confirmationMsg += `📞 *Your Phone Number:* ${reportData.contact_phone}\n`;
        confirmationMsg += `📝 *Description:* ${reportData.description}\n`;
        confirmationMsg += `🔐 *Verification Code:* ${verificationCode}\n\n`;
        
        // Safety tips for found item owner
        confirmationMsg += `🛡️ *Safety Tips for You (Item Finder):*\n`;
        confirmationMsg += `• Save this verification code - you'll need it to mark the item as claimed\n`;
        confirmationMsg += `• Always ask claimants to describe the item in detail\n`;
        confirmationMsg += `• Ask about specific features, colors, or marks\n`;
        confirmationMsg += `• Never return the item without proper verification\n`;
        confirmationMsg += `• Meet in public places if possible\n`;
        confirmationMsg += `• Trust your instincts - if something feels wrong, contact security\n\n`;
        
        confirmationMsg += `⚠️ *Important Safety Notice:*\n\n`;
        confirmationMsg += `🔐 *Verification Process:*\n`;
        confirmationMsg += `• Ask about: Exact color, size, shape, unique features\n`;
        confirmationMsg += `• Ask about contents (if applicable)\n`;
        confirmationMsg += `• Ask when and where the item was lost\n\n`;
        confirmationMsg += `🚫 *Report False Claimants:*\n`;
        confirmationMsg += `• If someone provides wrong details, do NOT return the item\n`;
        confirmationMsg += `• Contact KWASU WORKS immediately\n`;
        confirmationMsg += `• Provide the claimant's phone number\n\n`;
        confirmationMsg += `🛡️ *This helps maintain a safe community and prevents fraud.*\n\n`;
        
        // Add view details button
        const keyboard = [
          [
            { text: '📋 View Report Details', callback_data: `view_${reportId}` }
          ],
          [
            { text: '🔍 Main Menu', callback_data: 'menu' }
          ]
        ];
        
        confirmationMsg += `🙏 *Thank you for your honesty and for helping others!*`;
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
        await sendTelegramMessage(chatId, '❌ No items found in the database.\n\n💡 *New items are reported regularly. Please check back again soon!*');
        return;
      }

      let response = `🔎 *Search Results for "${msg}"*\n\n`;
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
            response += `${itemButtons.length + 1}. 🔍 *${report.item}*\n`;
            response += `   📍 Location: ${report.location}\n`;
            response += `   📝 ${report.description}\n`;
            response += `   📊 Status: ${status}\n`;
            response += `   ⏰ ${new Date(report.timestamp).toLocaleString()}\n\n`;
            
            if (!report.recovered) {
              itemButtons.push([{ text: `${itemButtons.length + 1}. ${report.item}`, callback_data: `view_${key}` }]);
            }
          } else {
            foundFound = true;
            const status = report.claimed ? '✅ Claimed' : '❌ Not Claimed';
            response += `${itemButtons.length + 1}. 🎁 *${report.item}*\n`;
            response += `   📍 Location: ${report.location}\n`;
            response += `   📝 ${report.description}\n`;
            response += `   📞 Contact: ${report.contact_phone}\n`;
            response += `   📊 Status: ${status}\n`;
            response += `   ⏰ ${new Date(report.timestamp).toLocaleString()}\n\n`;
            
            if (!report.claimed) {
              itemButtons.push([{ text: `${itemButtons.length + 1}. ${report.item}`, callback_data: `view_${key}` }]);
            }
          }
        }
      });
      
      if (!foundLost && !foundFound) {
        response += `❌ No items found matching "${msg}".\n\n`;
        response += `💡 *Tips:*\n`;
        response += `• Try different keywords (e.g., "phone" instead of "iPhone")\n`;
        response += `• Check spelling\n`;
        response += `• Keep checking back - new items are reported regularly!\n\n`;
        response += `🔄 *Please search again in a few hours or tomorrow as new items may be reported!*`;
      }
      
      const keyboard = [
        ...itemButtons,
        [
          { text: '🔍 Main Menu', callback_data: 'menu' }
        ]
      ];
      
      await sendTelegramMessage(chatId, response, keyboard);
      await remove(ref(db, `users/${from}`));
    }
  } catch (error) {
    console.error('Handle response error:', error);
    await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.');
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
