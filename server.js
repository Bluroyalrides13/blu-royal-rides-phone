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

// Get distance from Google Maps
async function getDistance(pickup, dropoff) {
    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(dropoff)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
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

// ============================================
// VOICE ENDPOINT
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call received from:', req.body.From);
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 3,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way. Press 2 for Hourly. Press 3 for voicemail.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// MENU HANDLER
// ============================================
app.post('/menu', (req, res) => {
    const Digits = req.body.Digits;
    const From = req.body.From;
    const CallSid = req.body.CallSid;
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (Digits === '1') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your pickup address.');
        activeCalls.set(CallSid, { phoneNumber: From, serviceType: 'oneWay', callSid: CallSid });
        
    } else if (Digits === '2') {
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 10,
            action: '/get-hours',
            method: 'POST'
        });
        gather.say('How many hours?');
        activeCalls.set(CallSid, { phoneNumber: From, serviceType: 'hourly', callSid: CallSid });
        
    } else if (Digits === '3') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 30,
            action: '/voicemail',
            method: 'POST'
        });
        gather.say('Leave your message after the beep.');
        activeCalls.set(CallSid, { phoneNumber: From, serviceType: 'voicemail', callSid: CallSid });
        
    } else {
        twiml.say('Invalid. Goodbye.');
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
    const From = req.body.From;
    
    console.log('Voicemail from:', From);
    console.log('Message:', SpeechResult);
    
    try {
        const params = new URLSearchParams({
            type: 'voicemail',
            phoneNumber: From,
            message: SpeechResult || 'No message',
            timestamp: new Date().toLocaleString()
        });
        axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
    } catch(e) { console.error(e); }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you. We will return your call within 24 hours. Goodbye.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET PICKUP
// ============================================
app.post('/get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-pickup', method: 'POST' });
        gather.say('Please say your pickup address again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-destination', method: 'POST' });
    gather.say('Please tell me your destination.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DESTINATION
// ============================================
app.post('/get-destination', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-destination', method: 'POST' });
        gather.say('Please say your destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    const distance = await getDistance(call.pickup, call.destination);
    const price = distance ? calculatePrice(distance) : BASE_FARE * 1.5;
    call.distance = distance || 25;
    call.price = price;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-name', method: 'POST' });
    const distText = distance ? `${distance.toFixed(1)} miles. ` : '';
    gather.say(`${distText}Total fare $${price.toFixed(2)}. Please tell me your name.`);
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET HOURS
// ============================================
app.post('/get-hours', (req, res) => {
    const Digits = req.body.Digits;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    let hours = Digits ? parseInt(Digits) : 1;
    call.hours = hours;
    call.price = hours * HOURLY_RATE;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-name', method: 'POST' });
    gather.say(`Total $${call.price.toFixed(2)} for ${hours} hours. Please tell me your name.`);
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
        const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-name', method: 'POST' });
        gather.say('Please tell me your name again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-email', method: 'POST' });
    gather.say('Please tell me your email address. Say it like john at gmail dot com.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET EMAIL & COMPLETE
// ============================================
app.post('/get-email', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 10, action: '/get-email', method: 'POST' });
        gather.say('Please tell me your email again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    // Convert speech to email
    let email = SpeechResult.toLowerCase()
        .replace(/\s+dot\s+/g, '.')
        .replace(/\s+at\s+/g, '@')
        .replace(/\s+/g, '')
        .replace(/dot/g, '.')
        .replace(/at/g, '@');
    
    const bookingCode = generateBookingCode();
    
    try {
        const bookingData = {
            bookingCode: bookingCode,
            serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
            fromAddress: call.pickup,
            toAddress: call.destination || `${call.hours} hours`,
            dateTime: new Date().toLocaleString(),
            distance: call.distance ? `${call.distance.toFixed(1)} miles` : 'N/A',
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: email,
            customerPhone: call.phoneNumber
        };
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log(`✅ Booking ${bookingCode}`);
    } catch (error) {
        console.error('Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Booking ${bookingCode} confirmed. $${call.price.toFixed(2)}. Invoice sent to ${email}. Goodbye.`);
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
    activeCalls.delete(CallSid);
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
