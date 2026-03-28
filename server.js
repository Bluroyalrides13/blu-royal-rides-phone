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

// Get distance from Google Maps - with timeout
async function getDistance(pickup, dropoff) {
    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(dropoff)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(url, { timeout: 3000 });
        const element = response.data.rows[0]?.elements[0];
        if (element && element.status === 'OK' && element.distance) {
            const miles = element.distance.text;
            return parseFloat(miles.split(' ')[0]);
        }
        return 15; // Faster default
    } catch (error) {
        console.error('Distance error:', error.message);
        return 15; // Quick default
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
    email = email.replace(/[^a-zA-Z0-9@._-]/g, '');
    return email;
}

// ============================================
// VOICE ENDPOINT - FAST
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call from:', req.body.From);
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 2,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    gather.say('Blu Royal Rides. Press 1 One Way. Press 2 Hourly. Press 3 Voicemail.');
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
            timeout: 5,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Pickup address?');
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'oneWay', 
            callSid: CallSid
        });
        
    } else if (Digits === '2') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 5,
            action: '/hourly-get-pickup',
            method: 'POST'
        });
        gather.say('Pickup location?');
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'hourly', 
            callSid: CallSid
        });
        
    } else if (Digits === '3') {
        twiml.say('Leave message after beep.');
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
// HOURLY - GET PICKUP
// ============================================
app.post('/hourly-get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/hourly-get-pickup', method: 'POST' });
        gather.say('Pickup again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech dtmf', timeout: 5, action: '/get-hours', method: 'POST' });
    gather.say('Hours needed?');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET HOURS
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
    hours = Math.min(Math.max(hours, 1), 24);
    
    call.hours = hours;
    call.price = hours * HOURLY_RATE;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-datetime', method: 'POST' });
    gather.say(`$${call.price} for ${hours} hours. Pickup date and time?`);
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DATE/TIME
// ============================================
app.post('/get-datetime', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-datetime', method: 'POST' });
        gather.say('Date and time?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.datetime = SpeechResult;
    
    if (call.serviceType === 'hourly') {
        activeCalls.set(CallSid, call);
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-agenda', method: 'POST' });
        gather.say('Purpose of trip?');
        res.type('text/xml');
        return res.send(twiml.toString());
    } else {
        call.step = 'name';
        activeCalls.set(CallSid, call);
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-name', method: 'POST' });
        gather.say('Your name?');
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// ============================================
// GET AGENDA (Hourly)
// ============================================
app.post('/get-agenda', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-agenda', method: 'POST' });
        gather.say('Purpose again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.agenda = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-name', method: 'POST' });
    gather.say('Your name?');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// ONE WAY - GET PICKUP
// ============================================
app.post('/get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-pickup', method: 'POST' });
        gather.say('Pickup again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-destination', method: 'POST' });
    gather.say('Destination?');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// ONE WAY - GET DESTINATION
// ============================================
app.post('/get-destination', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-destination', method: 'POST' });
        gather.say('Destination again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Get distance (with timeout)
    const distance = await getDistance(call.pickup, call.destination);
    const price = calculatePrice(distance);
    call.distance = distance;
    call.price = price;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-datetime', method: 'POST' });
    gather.say(`${distance.toFixed(0)} miles, $${price.toFixed(0)}. Date and time?`);
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
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-name', method: 'POST' });
        gather.say('Name again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-email', method: 'POST' });
    gather.say('Email? Say john at gmail dot com');
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
        const gather = twiml.gather({ input: 'speech', timeout: 5, action: '/get-email', method: 'POST' });
        gather.say('Email again?');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    const email = cleanEmail(SpeechResult);
    const bookingCode = generateBookingCode();
    
    try {
        let bookingData = {
            bookingCode: bookingCode,
            serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
            fromAddress: call.pickup,
            dateTime: call.datetime || new Date().toLocaleString(),
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: email,
            customerPhone: call.phoneNumber
        };
        
        if (call.serviceType === 'oneWay') {
            bookingData.toAddress = call.destination;
            bookingData.distance = call.distance ? `${call.distance.toFixed(1)} miles` : 'N/A';
        } else {
            bookingData.hours = call.hours;
            bookingData.agenda = call.agenda || 'Not specified';
        }
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`, { timeout: 3000 });
        console.log(`✅ Booking ${bookingCode}`);
    } catch (error) {
        console.error('Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thanks ${call.customerName}! ${bookingCode} confirmed. $${call.price}. Invoice to ${email}. Goodbye.`);
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
    activeCalls.delete(CallSid);
});

// ============================================
// VOICEMAIL
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
    twiml.say('Message saved. We will call you back within 24 hours. Goodbye.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'online', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
