const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuration
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";
const GOOGLE_MAPS_API_KEY = "AIzaSyAWXVHBwe-u1ZVKhD6A7jjqY09UVyQQgLI";

// Pricing
const BASE_FARE = 125.00;
const HOURLY_RATE = 125.00;

// Store active calls
const activeCalls = new Map();

// Generate booking reference
function generateBookingCode() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BRR-${random}`;
}

// Calculate price based on distance
function calculatePrice(distance) {
    let mileageRate = 1.80;
    if (distance > 150) mileageRate = 2.80;
    else if (distance > 100) mileageRate = 2.40;
    else if (distance > 50) mileageRate = 2.00;
    return BASE_FARE + (distance * mileageRate);
}

// Get distance from Google Maps with better address handling
async function getDistance(pickup, dropoff) {
    try {
        // Clean addresses
        const cleanPickup = pickup.replace(/[^\w\s,.-]/g, '').trim();
        const cleanDropoff = dropoff.replace(/[^\w\s,.-]/g, '').trim();
        
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(cleanPickup)}&destinations=${encodeURIComponent(cleanDropoff)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(url);
        
        const element = response.data.rows[0]?.elements[0];
        
        if (element && element.status === 'OK' && element.distance) {
            const miles = element.distance.text;
            return parseFloat(miles.split(' ')[0]);
        }
        return null;
    } catch (error) {
        console.error('Distance error:', error.message);
        return null;
    }
}

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Spell out email for confirmation
function spellEmail(email) {
    return email.replace(/\./g, ' dot ').replace(/@/g, ' at ');
}

// ============================================
// VOICE ENDPOINT
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call received from:', req.body.From);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
        input: 'dtmf speech',
        timeout: 3,
        numDigits: 1,
        speechTimeout: 'auto',
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service. Press 3 to leave a voicemail.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// MENU HANDLER
// ============================================
app.post('/menu', (req, res) => {
    const Digits = req.body.Digits;
    const SpeechResult = req.body.SpeechResult;
    const From = req.body.From;
    const CallSid = req.body.CallSid;
    
    let choice = Digits;
    if (!choice && SpeechResult) {
        const speech = SpeechResult.toLowerCase();
        if (speech.includes('one') || speech.includes('1')) choice = '1';
        if (speech.includes('two') || speech.includes('2')) choice = '2';
        if (speech.includes('three') || speech.includes('3') || speech.includes('voicemail')) choice = '3';
    }
    
    console.log('Choice:', choice);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (choice === '1') {
        // One Way - ask for full address
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your complete pickup address including street, city, and state. For example, 123 Main Street, Tampa, Florida.');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'oneWay',
            callSid: CallSid,
            step: 'pickup'
        });
        
    } else if (choice === '2') {
        // Hourly service
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 10,
            action: '/get-hours',
            method: 'POST'
        });
        gather.say('How many hours will you need the vehicle?');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'hourly',
            callSid: CallSid,
            step: 'hours'
        });
        
    } else if (choice === '3') {
        // Voicemail
        const gather = twiml.gather({
            input: 'speech',
            timeout: 30,
            speechTimeout: 'auto',
            action: '/voicemail',
            method: 'POST'
        });
        gather.say('Please leave your message after the beep. Press the pound key when finished.');
        twiml.say('Recording message...');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'voicemail',
            callSid: CallSid
        });
        
    } else {
        twiml.say('Invalid selection. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// VOICEMAIL HANDLER
// ============================================
app.post('/voicemail', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const From = req.body.From;
    const call = activeCalls.get(CallSid);
    
    // Send voicemail to email or log it
    console.log('📧 VOICEMAIL RECEIVED:');
    console.log('From:', From);
    console.log('Message:', SpeechResult);
    
    // Send to Google Sheet as voicemail
    try {
        const voicemailData = {
            type: 'voicemail',
            phoneNumber: From,
            message: SpeechResult || 'No message recorded',
            timestamp: new Date().toLocaleString()
        };
        
        const params = new URLSearchParams(voicemailData);
        axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
    } catch (error) {
        console.error('Voicemail error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for your message. Someone from Blu Royal Rides will return your call within 24 hours. Goodbye.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
    activeCalls.delete(CallSid);
});

// ============================================
// GET PICKUP - FULL ADDRESS
// ============================================
app.post('/get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say your complete pickup address again, including street, city, and state.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: '/get-destination',
        method: 'POST'
    });
    gather.say('Please tell me your complete destination address including street, city, and state.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DESTINATION WITH PRICE
// ============================================
app.post('/get-destination', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('Please say your complete destination address again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Calculate distance using Google Maps
    const distance = await getDistance(call.pickup, call.destination);
    
    if (distance === null) {
        // Address not found, ask again
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('I couldn\'t find that address. Please say your complete destination address again, including city and state.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    const price = calculatePrice(distance);
    call.distance = distance;
    call.price = price;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: '/get-datetime',
        method: 'POST'
    });
    gather.say(`The distance is ${distance.toFixed(1)} miles. The total fare is $${price.toFixed(2)}. Please tell me your pickup date and time. For example, tomorrow at 3 PM.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DATE AND TIME
// ============================================
app.post('/get-datetime', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-datetime',
            method: 'POST'
        });
        gather.say('Please tell me your pickup date and time again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.datetime = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: '/get-name',
        method: 'POST'
    });
    gather.say('Please tell me your full name for the reservation.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET HOURS (Hourly Service)
// ============================================
app.post('/get-hours', (req, res) => {
    const Digits = req.body.Digits;
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    let hours = 1;
    if (Digits) {
        hours = parseInt(Digits);
    } else if (SpeechResult) {
        const match = SpeechResult.match(/(\d+)/);
        if (match) hours = parseInt(match[1]);
    }
    
    call.hours = hours;
    call.price = hours * HOURLY_RATE;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: '/get-datetime',
        method: 'POST'
    });
    gather.say(`The total fare is $${call.price.toFixed(2)} for ${hours} hours. Please tell me your pickup date and time.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET NAME
// ============================================
app.post('/get-name', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-name',
            method: 'POST'
        });
        gather.say('Please tell me your full name again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        speechTimeout: 'auto',
        action: '/get-email',
        method: 'POST'
    });
    gather.say('Please tell me your email address. You can say it slowly, like john dot smith at gmail dot com.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET EMAIL - IMPROVED UNDERSTANDING
// ============================================
app.post('/get-email', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-email',
            method: 'POST'
        });
        gather.say('Please tell me your email address again. Say it slowly, like john at gmail dot com.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    // Convert speech to email format
    let email = SpeechResult.toLowerCase()
        .replace(/\s+dot\s+/g, '.')
        .replace(/\s+at\s+/g, '@')
        .replace(/\s+/g, '')
        .replace(/dot/g, '.')
        .replace(/at/g, '@')
        .replace(/\[dot\]/g, '.')
        .replace(/\[at\]/g, '@');
    
    // Remove any remaining spaces
    email = email.replace(/\s/g, '');
    
    if (!isValidEmail(email)) {
        // Email format is wrong, ask again
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-email',
            method: 'POST'
        });
        gather.say(`I heard ${SpeechResult}. Please tell me your email again. For example, say john at gmail dot com.`);
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerEmail = email;
    const bookingCode = generateBookingCode();
    
    // Confirm email before sending
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'dtmf speech',
        timeout: 5,
        numDigits: 1,
        action: `/confirm-email?bookingCode=${bookingCode}`,
        method: 'POST'
    });
    gather.say(`I have ${spellEmail(email)}. If this is correct, press 1. If not, press 2 to say it again.`);
    
    // Store email for confirmation
    call.pendingEmail = email;
    call.bookingCode = bookingCode;
    activeCalls.set(CallSid, call);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// CONFIRM EMAIL AND COMPLETE BOOKING
// ============================================
app.post('/confirm-email', async (req, res) => {
    const Digits = req.body.Digits;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (Digits === '1') {
        // Email confirmed, send booking
        try {
            const bookingData = {
                bookingCode: call.bookingCode,
                serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
                fromAddress: call.pickup,
                toAddress: call.destination || `${call.hours} hours`,
                dateTime: call.datetime || new Date().toLocaleString(),
                distance: call.distance ? `${call.distance.toFixed(1)} miles` : 'N/A',
                totalFare: call.price.toFixed(2),
                customerName: call.customerName,
                customerEmail: call.pendingEmail,
                customerPhone: call.phoneNumber,
                passengers: '1',
                luggage: '0'
            };
            
            const params = new URLSearchParams(bookingData);
            await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
            console.log(`✅ Booking ${call.bookingCode} sent to Google Sheet`);
        } catch (error) {
            console.error('Google Sheet error:', error.message);
        }
        
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say(`Thank you ${call.customerName}! Your booking ${call.bookingCode} is confirmed. Total fare is $${call.price.toFixed(2)}. A Square invoice will be sent to ${spellEmail(call.pendingEmail)}. Thank you for choosing Blu Royal Rides!`);
        twiml.hangup();
        
        res.type('text/xml');
        res.send(twiml.toString());
        activeCalls.delete(CallSid);
        
    } else {
        // Email incorrect, ask again
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            speechTimeout: 'auto',
            action: '/get-email',
            method: 'POST'
        });
        gather.say('Please tell me your email address again. Say it slowly, like john at gmail dot com.');
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'online', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
