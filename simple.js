const express = require('express');
const twilio = require('twilio');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.all('/voice', (req, res) => {
    console.log('📞 Call received!');
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Hello! This is Blu Royal Rides. Your phone system is working!');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
});

app.get('/health', (req, res) => {
    res.send('OK');
});

app.listen(3000, () => {
    console.log('✅ Server running on port 3000');
});
