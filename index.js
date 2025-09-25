const express = require('express');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push, set, get, child, remove } = require('firebase/database');
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

// Handle Telegram updates
expressApp.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const text = message.text.toLowerCase();
      const from = message.from.id.toString();

      // Handle commands
      if (text === '/start' || text === 'menu') {
        await sendTelegramMessage(chatId, `📋 *Welcome to Kwasu Lost And Found Bot!*\n_v0.1 Designed & Developed by_ Rugged of ICT.\n\nTo proceed with, Select what you are here for from the menu:\n\n1. *Report Lost Item*\n2. *Report Found Item*\n3. *Search for my lost Item*\n4. *Contact Developer*\n\nKindly Reply with 1, 2, 3, or 4.`);
      } 
      // Report lost
      else if (text === '1') {
        await sendTelegramMessage(chatId, '🔍 *Report Lost Item*\n\nPlease provide the following details:\nITEM, LOCATION, DESCRIPTION\n\nExample: "Water Bottle, Library, Blue with sticker"');
        await set(ref(db, `users/${from}`), { action: 'report_lost' });
      }
      // Report found
      else if (text === '2') {
        await sendTelegramMessage(chatId, '🎁 *Report Found Item*\n\nPlease provide the following details:\nITEM, LOCATION, YOUR_PHONE_NUMBER\n\n⚠️ *Important:* The phone number should be YOUR phone number (the person who found the item) so the owner can contact you.\n\nExample: "Keys, Cafeteria, 08012345678"');
        await set(ref(db, `users/${from}`), { action: 'report_found' });
      }
      // Search
      else if (text === '3') {
        await sendTelegramMessage(chatId, '🔎 *Search for my lost Item*\n\nPlease reply with a keyword to search:\n\nExample: "water", "keys", "bag"\n\n💡 *Tip: Keep checking back regularly as new items are reported all the time!*');
        await set(ref(db, `users/${from}`), { action: 'search' });
      }
      // Contact developer
      else if (text === '4') {
        await sendTelegramMessage(chatId, `📞 *Contact Developer*\n\nFor any issues or support, please contact the developer:\n\n*WhatsApp:* 09038323588\n\n*Note:* Please go straight to the point in your DM to avoid late response. Be direct and clear about your issue or inquiry.`);
      }
      // Handle responses
      else {
        await handleTelegramResponse(from, text, chatId);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram update error:', error);
    res.sendStatus(500);
  }
});

async function handleTelegramResponse(from, msg, chatId) {
  try {
    // Get user state
    const userRef = ref(db, `users/${from}`);
    const userSnapshot = await get(userRef);
    const user = userSnapshot.val();
    
    if (!user) {
      await sendTelegramMessage(chatId, '❓ Invalid command. Reply "menu" for options.');
      return;
    }

    // Handle report submission
    if (user.action === 'report_lost' || user.action === 'report_found') {
      const parts = msg.split(',');
      if (parts.length < 3) {
        await sendTelegramMessage(chatId, `⚠️ Format error. Please use: ${user.action === 'report_lost' ? 'ITEM, LOCATION, DESCRIPTION' : 'ITEM, LOCATION, YOUR_PHONE_NUMBER'}`);
        return;
      }
      
      const item = parts[0].trim();
      const location = parts[1].trim();
      const thirdPart = parts[2].trim();
      
      let reportData = {
        type: user.action.replace('report_', ''),
        item,
        location,
        reporter: from,
        timestamp: new Date().toISOString()
      };
      
      if (user.action === 'report_lost') {
        reportData.description = parts.slice(2).join(',').trim();
      } else {
        reportData.contact_phone = thirdPart;
        reportData.description = parts.slice(3).join(',').trim() || 'No description';
      }
      
      // Save to Firebase
      const reportsRef = ref(db, 'reports');
      const newReportRef = push(reportsRef);
      await set(newReportRef, reportData);

      // Send confirmation
      if (user.action === 'report_lost') {
        // Enhanced confirmation for lost items
        let confirmationMsg = `✅ *Lost Item Reported Successfully!*\n\n`;
        confirmationMsg += `📦 *Item:* ${item}\n`;
        confirmationMsg += `📍 *Location:* ${location}\n`;
        confirmationMsg += `📝 *Description:* ${reportData.description}\n\n`;
        
        // Tips for lost item owner
        confirmationMsg += `💡 *Tips for You (Item Owner):*\n`;
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
        
        confirmationMsg += `🙏 *Thank you for using KWASU Lost & Found Bot!*`;
        await sendTelegramMessage(chatId, confirmationMsg);
      } else {
        // Confirmation with safety warning for found items
        let confirmationMsg = `✅ *Found Item Reported Successfully!*\n\n`;
        confirmationMsg += `📦 *Item:* ${item}\n`;
        confirmationMsg += `📍 *Location:* ${location}\n`;
        confirmationMsg += `📞 *Your Phone Number:* ${reportData.contact_phone}\n`;
        confirmationMsg += `📝 *Description:* ${reportData.description}\n\n`;
        
        // Safety tips for found item owner
        confirmationMsg += `🛡️ *Safety Tips for You (Item Finder):*\n`;
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
        confirmationMsg += `🙏 *Thank you for your honesty and for helping others!*`;
        
        await sendTelegramMessage(chatId, confirmationMsg);
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
      
      // Separate lost and found items
      Object.entries(reports).forEach(([key, report]) => {
        const searchText = `${report.item} ${report.location} ${report.description}`.toLowerCase();
        if (searchText.includes(msg.toLowerCase())) {
          if (report.type === 'lost') {
            foundLost = true;
          } else {
            foundFound = true;
          }
        }
      });
      
      // Show lost items first
      if (foundLost) {
        response += `🔍 *Lost Items Matching Your Search:*\n\n`;
        Object.entries(reports).forEach(([key, report]) => {
          if (report.type === 'lost') {
            const searchText = `${report.item} ${report.location} ${report.description}`.toLowerCase();
            if (searchText.includes(msg.toLowerCase())) {
              response += `📦 *${report.item}*\n`;
              response += `📍 Location: ${report.location}\n`;
              response += `📝 ${report.description}\n`;
              response += `⏰ ${new Date(report.timestamp).toLocaleString()}\n\n`;
            }
          }
        });
      }
      
      // Show found items
      if (foundFound) {
        response += `🎁 *Found Items Matching Your Search:*\n\n`;
        Object.entries(reports).forEach(([key, report]) => {
          if (report.type === 'found') {
            const searchText = `${report.item} ${report.location} ${report.description}`.toLowerCase();
            if (searchText.includes(msg.toLowerCase())) {
              response += `📦 *${report.item}*\n`;
              response += `📍 Location: ${report.location}\n`;
              response += `📝 ${report.description}\n`;
              response += `📞 Contact: ${report.contact_phone}\n`;
              response += `⏰ ${new Date(report.timestamp).toLocaleString()}\n\n`;
            }
          }
        });
      }
      
      if (!foundLost && !foundFound) {
        response += `❌ No items found matching "${msg}".\n\n`;
        response += `💡 *Tips:*\n`;
        response += `• Try different keywords (e.g., "phone" instead of "iPhone")\n`;
        response += `• Check spelling\n`;
        response += `• Keep checking back - new items are reported regularly!\n\n`;
        response += `🔄 *Please search again in a few hours or tomorrow as new items may be reported!*`;
      }
      
      await sendTelegramMessage(chatId, response);
      await remove(ref(db, `users/${from}`));
    }
  } catch (error) {
    console.error('Handle response error:', error);
    await sendTelegramMessage(chatId, '❌ An error occurred. Please try again.');
  }
}

// Helper function to send Telegram messages
async function sendTelegramMessage(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Send message error:', error);
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
