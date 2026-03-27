const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple voice endpoint
app.post('/voice', (req, res) => {
    console.log('Call received!');
    console.log('From:', req.body.From);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 10,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service.');
    
    // If no input, repeat
    twiml.say('No selection received. Goodbye.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Menu handler
app.post('/menu', (req, res) => {
    console.log('Menu choice:', req.body.Digits);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (req.body.Digits === '1') {
        twiml.say('You selected One Way service. Thank you for calling Blu Royal Rides!');
    } else if (req.body.Digits === '2') {
        twiml.say('You selected Hourly service. Thank you for calling Blu Royal Rides!');
    } else {
        twiml.say('Invalid selection. Goodbye.');
    }
    
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'online', time: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
