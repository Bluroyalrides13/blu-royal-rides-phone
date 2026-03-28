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

function generateBookingCode() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BRR-${random}`;
}

// Price formula - total price only, no breakdown
function calculatePrice(distance) {
    let rate = 1.80;
    if (distance > 150) rate = 2.80;
    else if (distance > 100) rate = 2.40;
    else if (distance > 50) rate = 2.00;
    const total = BASE_FARE + (distance * rate);
    return total;
}

// Get distance and duration from Google Maps
async function getDistanceAndDuration(pickup, dropoff) {
    try {
        console.log(`Calculating from: ${pickup} to: ${dropoff}`);
        
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pickup)}&destinations=${encodeURIComponent(dropoff)}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;
        
        const response = await axios.get(url, { timeout: 8000 });
        
        const element = response.data.rows[0]?.elements[0];
        
        if (element && element.status === 'OK' && element.distance && element.duration) {
            const miles = element.distance.text;
            const milesValue = parseFloat(miles.split(' ')[0]);
            const durationText = element.duration.text;
            const durationMinutes = Math.ceil(element.duration.value / 60);
            console.log(`Distance: ${milesValue} miles, Duration: ${durationMinutes} minutes`);
            return { distance: milesValue, duration: durationMinutes, durationText: durationText };
        } else {
            console.log('Distance not found, using fallback');
            return { distance: 15, duration: 30, durationText: '30 minutes' };
        }
    } catch (error) {
        console.error('Distance error:', error.message);
        return { distance: 15, duration: 30, durationText: '30 minutes' };
    }
}

function cleanEmail(speech) {
    let email = speech.toLowerCase()
        .replace(/\s+dot\s+/g, '.')
        .replace(/\s+at\s+/g, '@')
        .replace(/ dot /g, '.')
        .replace(/ at /g, '@')
        .replace(/\s+/g, '')
        .replace(/dot/g, '.')
        .replace(/at/g, '@');
    return email.replace(/[^a-zA-Z0-9@._-]/g, '');
}

// ============================================
// VOICE ENDPOINT
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call from:', req.body.From);
    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 5,
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
    
    console.log('Menu choice:', Digits);
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (Digits === '1') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 8,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say your pickup address.');
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'oneWay', 
            callSid: CallSid,
            step: 'pickup'
        });
        
    } else if (Digits === '2') {
        const gather = twiml.gather({
            input: 'speech',
            timeout: 8,
            action: '/hourly-pickup',
            method: 'POST'
        });
        gather.say('Please say your pickup address.');
        activeCalls.set(CallSid, { 
            phoneNumber: From, 
            serviceType: 'hourly', 
            callSid: CallSid 
        });
        
    } else if (Digits === '3') {
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
// HOURLY SERVICE
// ============================================
app.post('/hourly-pickup', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/hourly-pickup', method: 'POST' });
        gather.say('Please say your pickup address again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech dtmf', timeout: 8, action: '/hourly-hours', method: 'POST' });
    gather.say('How many hours do you need?');
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/hourly-hours', (req, res) => {
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
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/hourly-datetime', method: 'POST' });
    gather.say(`${hours} hours, total $${call.price.toFixed(0)}. Please tell me your pickup date and time.`);
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/hourly-datetime', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/hourly-datetime', method: 'POST' });
        gather.say('Please tell me your pickup date and time again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.datetime = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/hourly-agenda', method: 'POST' });
    gather.say('What will you be doing during this trip?');
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/hourly-agenda', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/hourly-agenda', method: 'POST' });
        gather.say('Please tell me your trip purpose again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.agenda = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-name', method: 'POST' });
    gather.say('Please tell me your name.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// ONE WAY - PICKUP
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
// ONE WAY - DESTINATION (with total price)
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
    
    // Get real distance and duration
    const routeInfo = await getDistanceAndDuration(call.pickup, call.destination);
    call.distance = routeInfo.distance;
    call.duration = routeInfo.duration;
    call.durationText = routeInfo.durationText;
    
    // Calculate total price (no breakdown)
    call.price = calculatePrice(call.distance);
    
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech dtmf', timeout: 8, action: '/get-passengers', method: 'POST' });
    gather.say(`${call.distance.toFixed(0)} miles, about ${call.durationText} drive time. Total $${call.price.toFixed(0)}. How many passengers?`);
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET NUMBER OF PASSENGERS
// ============================================
app.post('/get-passengers', (req, res) => {
    const Digits = req.body.Digits;
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    let passengers = 1;
    if (Digits) {
        passengers = parseInt(Digits);
    } else if (SpeechResult) {
        const match = SpeechResult.match(/(\d+)/);
        if (match) passengers = parseInt(match[1]);
    }
    passengers = Math.min(Math.max(passengers, 1), 8);
    
    call.passengers = passengers;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech dtmf', timeout: 8, action: '/get-luggage', method: 'POST' });
    gather.say(`${passengers} passenger${passengers > 1 ? 's' : ''}. How many luggage bags?`);
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET LUGGAGE AMOUNT
// ============================================
app.post('/get-luggage', (req, res) => {
    const Digits = req.body.Digits;
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    let luggage = 0;
    if (Digits) {
        luggage = parseInt(Digits);
    } else if (SpeechResult) {
        const match = SpeechResult.match(/(\d+)/);
        if (match) luggage = parseInt(match[1]);
    }
    luggage = Math.min(Math.max(luggage, 0), 10);
    
    call.luggage = luggage;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-special-requests', method: 'POST' });
    gather.say(`${luggage} bag${luggage !== 1 ? 's' : ''}. Do you have any special requests?`);
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET SPECIAL REQUESTS
// ============================================
app.post('/get-special-requests', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    call.specialRequests = SpeechResult || 'None';
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/oneway-datetime', method: 'POST' });
    gather.say('Please tell me your pickup date and time.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// ONE WAY - DATETIME
// ============================================
app.post('/oneway-datetime', (req, res) => {
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/oneway-datetime', method: 'POST' });
        gather.say('Please tell me your pickup date and time again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.datetime = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-name', method: 'POST' });
    gather.say('Please tell me your name.');
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET NAME (Common)
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
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({ input: 'speech', timeout: 8, action: '/get-email', method: 'POST' });
    gather.say('Please tell me your email. Say john at gmail dot com.');
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
    
    const email = cleanEmail(SpeechResult);
    const bookingCode = generateBookingCode();
    
    try {
        let bookingData = {
            bookingCode: bookingCode,
            serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
            fromAddress: call.pickup,
            toAddress: call.destination || 'Hourly Service',
            dateTime: call.datetime || new Date().toLocaleString(),
            distance: call.distance ? `${call.distance.toFixed(1)} miles` : 'N/A',
            duration: call.durationText || 'N/A',
            passengers: call.passengers || 1,
            luggage: call.luggage || 0,
            specialRequests: call.specialRequests || 'None',
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: email,
            customerPhone: call.phoneNumber
        };
        
        if (call.serviceType === 'hourly') {
            bookingData.hours = call.hours;
            bookingData.agenda = call.agenda || 'Not specified';
        }
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`, { timeout: 5000 });
        console.log(`✅ Booking ${bookingCode}`);
    } catch (error) {
        console.error('Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    let confirmationMsg = `Thank you ${call.customerName}! Booking ${bookingCode} confirmed. `;
    
    if (call.serviceType === 'oneWay') {
        confirmationMsg += `${call.distance.toFixed(0)} miles, about ${call.durationText}, ${call.passengers} passenger${call.passengers > 1 ? 's' : ''}, ${call.luggage} bag${call.luggage !== 1 ? 's' : ''}. Total $${call.price.toFixed(0)}. Invoice to ${email}. Goodbye.`;
    } else {
        confirmationMsg += `${call.hours} hours, total $${call.price.toFixed(0)}. Invoice to ${email}. Goodbye.`;
    }
    
    twiml.say(confirmationMsg);
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
