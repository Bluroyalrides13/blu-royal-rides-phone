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
        return 25; // Default distance
    } catch (error) {
        console.error('Distance error:', error.message);
        return 25;
    }
}

// Clean email from speech
function cleanEmail(speech) {
    let email = speech.toLowerCase()
        .replace(/\s+dot\s+/g, '.')
        .replace(/\s+at\s+/g, '@')
        .replace(/ dot /g, '.')
        .replace(/ at /g, '@')
        .replace(/\s+/g, '')
        .replace(/dot/g, '.')
        .replace(/at/g, '@');
    
    // Remove any non-email characters at the end
    email = email.replace(/[^a-zA-Z0-9@._-]/g, '');
    return email;
}

// ============================================
// VOICE ENDPOINT
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call received from:', req.body.From);
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 2,
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
        // One Way - ask for pickup
        const gather = twiml.gather({
            input: 'speech',
            timeout: 8,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your pickup address.');
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'oneWay', 
            callSid: CallSid,
            step: 'pickup'
        });
        
    } else if (Digits === '2') {
        // Hourly - ask for hours
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 8,
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
        
    } else if (Digits === '3') {
        // Voicemail with beep
        twiml.say('Leave your message after the beep.');
        twiml.pause({ length: 1 });
        twiml.play('http://www.twilio.com/docs/demos/show_mail_beep');
        
        const gather = twiml.gather({
            input: 'speech',
            timeout: 30,
            action: '/voicemail',
            method: 'POST'
        });
        
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'voicemail', 
            callSid: CallSid 
        });
        
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
    
    console.log('📧 VOICEMAIL RECEIVED:');
    console.log('From:', From);
    console.log('Message:', SpeechResult);
    
    try {
        const params = new URLSearchParams({
            type: 'voicemail',
            phoneNumber: From,
            message: SpeechResult || 'No message recorded',
            timestamp: new Date().toLocaleString()
        });
        axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log('✅ Voicemail saved');
    } catch(e) { 
        console.error('Voicemail error:', e); 
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Thank you for your message. Someone will return your call within 24 hours. Goodbye.');
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
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-pickup', method: 'POST' });
        gather.say('Please say your pickup address again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    call.step = 'destination';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-destination', method: 'POST' });
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
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-destination', method: 'POST' });
        gather.say('Please say your destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    const distance = await getDistance(call.pickup, call.destination);
    const price = calculatePrice(distance);
    call.distance = distance;
    call.price = price;
    call.step = 'datetime';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-datetime', method: 'POST' });
    gather.say(`The distance is ${distance.toFixed(1)} miles. Total fare is $${price.toFixed(2)}. Please tell me your pickup date and time, like tomorrow at 3 PM.`);
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
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-datetime', method: 'POST' });
        gather.say('Please tell me your pickup date and time again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.datetime = SpeechResult;
    call.step = 'name';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-name', method: 'POST' });
    gather.say('Please tell me your full name.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET HOURS (FIXED - calculates correctly)
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
    
    // Ensure hours is at least 1 and not more than 24
    hours = Math.min(Math.max(hours, 1), 24);
    
    call.hours = hours;
    call.price = hours * HOURLY_RATE;  // This now calculates correctly: 5 hours = $625
    call.step = 'datetime';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-datetime', method: 'POST' });
    gather.say(`Total fare is $${call.price.toFixed(2)} for ${hours} hours. Please tell me your pickup date and time.`);
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
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-name', method: 'POST' });
        gather.say('Please tell me your name again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    call.step = 'email';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-email', method: 'POST' });
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
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-email', method: 'POST' });
        gather.say('Please tell me your email again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    // Clean email from speech
    const email = cleanEmail(SpeechResult);
    const bookingCode = generateBookingCode();
    
    try {
        const bookingData = {
            bookingCode: bookingCode,
            serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
            fromAddress: call.pickup,
            toAddress: call.destination || `${call.hours} hours`,
            dateTime: call.datetime || new Date().toLocaleString(),
            distance: call.distance ? `${call.distance.toFixed(1)} miles` : 'N/A',
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: email,
            customerPhone: call.phoneNumber
        };
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log(`✅ Booking ${bookingCode} sent to Google Sheet`);
    } catch (error) {
        console.error('Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Booking ${bookingCode} confirmed. Total fare $${call.price.toFixed(2)}. Invoice sent to ${email}. Goodbye.`);
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
