const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();

// Parse incoming requests
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Your Google Script URL from Wix
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";

// Pricing formulas
const BASE_FARE = 125.00;
const HOURLY_RATE = 125.00;

// Store active calls
const activeCalls = new Map();

// Generate booking reference
function generateBookingCode() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BRR-${random}`;
}

// ============================================
// VOICE ENDPOINT - Answers the phone
// ============================================
app.post('/voice', (req, res) => {
    console.log('=== VOICE ENDPOINT CALLED ===');
    const fromNumber = req.body.From || 'Unknown';
    console.log('📞 Call received from:', fromNumber);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    // Add a small pause before greeting
    twiml.pause({ length: 1 });
    
    const gather = twiml.gather({
        input: 'dtmf speech',
        timeout: 10,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service.');
    
    // If no input, repeat the message
    twiml.redirect('/voice');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// MENU HANDLER - Process the menu choice
// ============================================
app.post('/menu', (req, res) => {
    console.log('=== MENU HANDLER CALLED ===');
    console.log('Request body:', req.body);
    
    const Digits = req.body.Digits;
    const SpeechResult = req.body.SpeechResult;
    const From = req.body.From;
    const CallSid = req.body.CallSid;
    
    // Determine choice from DTMF or speech
    let choice = Digits;
    if (!choice && SpeechResult) {
        const speech = SpeechResult.toLowerCase();
        if (speech.includes('one') || speech.includes('1')) choice = '1';
        if (speech.includes('two') || speech.includes('2') || speech.includes('hour')) choice = '2';
    }
    
    console.log(`Choice: ${choice} from ${From}`);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    
    if (choice === '1') {
        // One Way Service
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your pickup location.');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'oneWay',
            callSid: CallSid
        });
        
    } else if (choice === '2') {
        // Hourly Service
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
            callSid: CallSid
        });
        
    } else {
        // No valid input, try again
        const gather = twiml.gather({
            input: 'dtmf speech',
            timeout: 10,
            numDigits: 1,
            action: '/menu',
            method: 'POST'
        });
        gather.say('I didn\'t catch that. Press 1 for One Way trip. Press 2 for Hourly service.');
        twiml.redirect('/menu');
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET PICKUP LOCATION (One Way)
// ============================================
app.post('/get-pickup', (req, res) => {
    console.log('=== GET PICKUP CALLED ===');
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say your pickup location again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-destination',
        method: 'POST'
    });
    gather.say('Please tell me your destination.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DESTINATION (One Way)
// ============================================
app.post('/get-destination', (req, res) => {
    console.log('=== GET DESTINATION CALLED ===');
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('Please say your destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Calculate price based on distance
    const distance = 25; // miles (you can add real distance calculation later)
    let mileageRate = 1.80;
    if (distance > 150) mileageRate = 2.80;
    else if (distance > 100) mileageRate = 2.40;
    else if (distance > 50) mileageRate = 2.00;
    
    const total = BASE_FARE + (distance * mileageRate);
    call.price = total;
    
    activeCalls.set(CallSid, call);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`The estimated fare is $${total.toFixed(2)}. Please tell me your full name.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET HOURS (Hourly Service)
// ============================================
app.post('/get-hours', (req, res) => {
    console.log('=== GET HOURS CALLED ===');
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
    const total = hours * HOURLY_RATE;
    call.price = total;
    activeCalls.set(CallSid, call);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`The estimated fare is $${total.toFixed(2)} for ${hours} hours. Please tell me your full name.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET CUSTOMER NAME
// ============================================
app.post('/get-name', (req, res) => {
    console.log('=== GET NAME CALLED ===');
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-name',
            method: 'POST'
        });
        gather.say('Please tell me your full name.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const gather = twiml.gather({
        input: 'speech dtmf',
        timeout: 10,
        action: '/get-email',
        method: 'POST'
    });
    gather.say('Please tell me your email address to send the invoice.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET EMAIL AND COMPLETE BOOKING
// ============================================
app.post('/get-email', async (req, res) => {
    console.log('=== GET EMAIL CALLED ===');
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const VoiceResponse = twilio.twiml.VoiceResponse;
        const twiml = new VoiceResponse();
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 10,
            action: '/get-email',
            method: 'POST'
        });
        gather.say('Please tell me your email address.');
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
            fromAddress: call.pickup || 'Not specified',
            toAddress: call.destination || `${call.hours} hours`,
            dateTime: new Date().toLocaleString(),
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: call.customerEmail,
            customerPhone: call.phoneNumber,
            passengers: '1',
            luggage: '0'
        };
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log(`✅ Booking ${bookingCode} sent to Google Sheet`);
    } catch (error) {
        console.error('Google Sheet error:', error.message);
    }
    
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Your booking ${bookingCode} is confirmed. Total fare is $${call.price.toFixed(2)}. A Square invoice will be sent to your email. Thank you for choosing Blu Royal Rides!`);
    twiml.hangup();
    
    console.log(`✅ Booking complete: ${bookingCode}`);
    
    res.type('text/xml');
    res.send(twiml.toString());
    
    activeCalls.delete(CallSid);
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Blu Royal Rides Phone System',
        time: new Date().toISOString()
    });
});

// ============================================
// PING TEST
// ============================================
app.get('/ping', (req, res) => {
    res.send('pong');
});

// ============================================
// ROOT ENDPOINT
// ============================================
app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System is running!');
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚗 Blu Royal Rides Phone System Running`);
    console.log(`📞 Voice endpoint: /voice`);
    console.log(`🏥 Health check: /health`);
    console.log(`🌐 Port: ${PORT}`);
});
