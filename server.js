const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'application/xml' }));

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

// Voice endpoint
app.all('/voice', (req, res) => {
    // Twilio sends data in both body and query parameters
    const fromNumber = req.body.From || req.query.From || 'Unknown';
    console.log('📞 Call received from:', fromNumber);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech dtmf',
        timeout: 3,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Menu handler
app.post('/menu', (req, res) => {
    const Digits = req.body.Digits || req.query.Digits;
    const From = req.body.From || req.query.From;
    const CallSid = req.body.CallSid || req.query.CallSid;
    
    console.log(`Menu choice: ${Digits} from ${From}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (Digits === '1') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 5,
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
        gather.say('How many hours will you need the vehicle?');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'hourly',
            callSid: CallSid
        });
        
    } else {
        twiml.say('Invalid selection. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Get pickup
app.post('/get-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult || req.query.SpeechResult;
    const CallSid = req.body.CallSid || req.query.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 3,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say your pickup location again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        action: '/get-destination',
        method: 'POST'
    });
    gather.say('Please tell me your destination.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Get destination
app.post('/get-destination', (req, res) => {
    const SpeechResult = req.body.SpeechResult || req.query.SpeechResult;
    const CallSid = req.body.CallSid || req.query.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 3,
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('Please say your destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Simple pricing calculation (using 25 miles as example)
    const distance = 25;
    let mileageRate = 1.80;
    if (distance > 150) mileageRate = 2.80;
    else if (distance > 100) mileageRate = 2.40;
    else if (distance > 50) mileageRate = 2.00;
    
    const total = BASE_FARE + (distance * mileageRate);
    call.price = total;
    
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`The estimated fare is $${total.toFixed(2)}. Please tell me your full name.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Get hours for hourly service
app.post('/get-hours', (req, res) => {
    const Digits = req.body.Digits || req.query.Digits;
    const SpeechResult = req.body.SpeechResult || req.query.SpeechResult;
    const CallSid = req.body.CallSid || req.query.CallSid;
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
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 5,
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`The estimated fare is $${total.toFixed(2)} for ${hours} hours. Please tell me your full name.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Get name
app.post('/get-name', (req, res) => {
    const SpeechResult = req.body.SpeechResult || req.query.SpeechResult;
    const CallSid = req.body.CallSid || req.query.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 3,
            action: '/get-name',
            method: 'POST'
        });
        gather.say('Please tell me your full name.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech dtmf',
        timeout: 5,
        action: '/get-email',
        method: 'POST'
    });
    gather.say('Please tell me your email address to send the invoice.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Get email and complete booking
app.post('/get-email', async (req, res) => {
    const SpeechResult = req.body.SpeechResult || req.query.SpeechResult;
    const CallSid = req.body.CallSid || req.query.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech dtmf',
            timeout: 3,
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
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Your booking ${bookingCode} is confirmed. Total fare is $${call.price.toFixed(2)}. A Square invoice will be sent to your email. Thank you for choosing Blu Royal Rides!`);
    twiml.hangup();
    
    console.log(`✅ Booking complete: ${bookingCode}`);
    
    res.type('text/xml');
    res.send(twiml.toString());
    
    activeCalls.delete(CallSid);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Blu Royal Rides Phone System',
        time: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚗 Blu Royal Rides Phone System Running`);
    console.log(`📞 Voice endpoint: /voice`);
    console.log(`🏥 Health check: /health`);
    console.log(`🌐 Port: ${PORT}`);
});
