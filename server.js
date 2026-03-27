const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";
const GOOGLE_MAPS_API_KEY = "AIzaSyAWXVHBwe-u1ZVKhD6A7jjqY09UVyQQgLI";

const BASE_FARE = 125.00;
const HOURLY_RATE = 125.00;

const activeCalls = new Map();

function generateBookingCode() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BRR-${random}`;
}

function calculatePrice(distance) {
    let mileageRate = 1.80;
    if (distance > 150) mileageRate = 2.80;
    else if (distance > 100) mileageRate = 2.40;
    else if (distance > 50) mileageRate = 2.00;
    return BASE_FARE + (distance * mileageRate);
}

async function getDistance(pickup, dropoff) {
    try {
        const cleanPickup = pickup.replace(/[^\w\s]/g, '').trim();
        const cleanDropoff = dropoff.replace(/[^\w\s]/g, '').trim();
        
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(cleanPickup)}&destinations=${encodeURIComponent(cleanDropoff)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(url);
        
        const element = response.data.rows[0]?.elements[0];
        
        if (element && element.status === 'OK' && element.distance) {
            const miles = element.distance.text;
            return parseFloat(miles.split(' ')[0]);
        }
        return 15; // Default
    } catch (error) {
        console.error('Distance error:', error.message);
        return 15;
    }
}

// ============================================
// VOICE ENDPOINT - Optimized
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
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way. Press 2 for Hourly.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// MENU HANDLER - Optimized
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
            speechTimeout: 'auto',
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your pickup location.');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'oneWay',
            callSid: CallSid
        });
        
    } else if (Digits === '2') {
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 5,
            action: '/get-hours',
            method: 'POST'
        });
        gather.say('How many hours?');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'hourly',
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
// GET PICKUP
// ============================================
app.post('/get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 5,
            speechTimeout: 'auto',
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say pickup again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        speechTimeout: 'auto',
        action: '/get-destination',
        method: 'POST'
    });
    gather.say('Please tell me your destination.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DESTINATION - With Google Maps
// ============================================
app.post('/get-destination', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 5,
            speechTimeout: 'auto',
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('Please say destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Get distance from Google Maps
    const distance = await getDistance(call.pickup, call.destination);
    const price = calculatePrice(distance);
    call.distance = distance;
    call.price = price;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        speechTimeout: 'auto',
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`Distance ${distance.toFixed(1)} miles. Fare $${price.toFixed(2)}. Please tell me your name.`);
    
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
    
    call.hours = hours;
    call.price = hours * HOURLY_RATE;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        speechTimeout: 'auto',
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`$${call.price.toFixed(2)} for ${hours} hours. Please tell me your name.`);
    
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
            timeout: 5,
            speechTimeout: 'auto',
            action: '/get-name',
            method: 'POST'
        });
        gather.say('Please tell me your name.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        speechTimeout: 'auto',
        action: '/get-email',
        method: 'POST'
    });
    gather.say('Please tell me your email for the invoice.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET EMAIL & COMPLETE BOOKING
// ============================================
app.post('/get-email', async (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 5,
            speechTimeout: 'auto',
            action: '/get-email',
            method: 'POST'
        });
        gather.say('Please tell me your email.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    const email = SpeechResult.toLowerCase().replace(/\s/g, '');
    call.customerEmail = email;
    const bookingCode = generateBookingCode();
    
    // Send to Google Sheet
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
            customerEmail: call.customerEmail,
            customerPhone: call.phoneNumber
        };
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log(`✅ Booking ${bookingCode}`);
    } catch (error) {
        console.error('Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Booking ${bookingCode} confirmed. $${call.price.toFixed(2)}. Invoice sent to your email.`);
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
