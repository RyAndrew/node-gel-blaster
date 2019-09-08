"use strict";

var i2cBus = require("i2c-bus");
var pca9685 = require("pca9685");

const WebSocket = require('ws');

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const httpPort = 8080;

// PCA9685 options
var options = {
	i2c: i2cBus.openSync(1),
	//address: 0x40, // generic PCA9685
	address: 0x60, // Adafruit Motor Driver
	frequency: 50
	//debug: true
};

var ServoMax = 2400;
var ServoMin = 800;
var ServoRange = ServoMax - ServoMin;

var pwmPanChannel = 15;
var pwmTiltChannel = 14;

var steeringValue = 500; // midpoint - straight foward

var throttleThreshold = 10.0
var throttleMidpoint = 500.0

var motorPwmMax = 4095
var motorPwmRange = 1000.0
var motorPwmOffset = motorPwmMax - motorPwmRange

var pwmShootChannel = 1;

var pwm = new pca9685.Pca9685Driver(options, function startLoop(err) {
	if (err) {
		console.error("Error initializing PCA9685");
		process.exit(-1);
	}

	console.log("PCA9685 Initialized");
});

pwm.setPulseLength(pwmPanChannel, 1500);
pwm.setPulseLength(pwmTiltChannel, 1500);

// function sendPwm(channel, onStep, offStep){

//     const channel0OnStepLowByte = 0x06; // LED0_ON_L
//     const channel0OnStepHighByte = 0x07; // LED0_ON_H
//     const channel0OffStepLowByte = 0x08; // LED0_OFF_L
//     const channel0OffStepHighByte = 0x09; // LED0_OFF_H
//     const registersPerChannel = 4;

// 	pwm.send([
// 		{ command: channel0OnStepLowByte + registersPerChannel * channel, byte: onStep & 0xFF },
//         { command: channel0OnStepHighByte + registersPerChannel * channel, byte: (onStep >> 8) & 0x0F },
//         { command: channel0OffStepLowByte + registersPerChannel * channel, byte: offStep & 0xFF },
//         { command: channel0OffStepHighByte + registersPerChannel * channel, byte: (offStep >> 8) & 0x0F }
// 	], 
// 	() => { return; }
// 	);

// }


// function motorSetPercent(motorNo, direction, throttlePercent){
// 	let pinPwm, pinin1, pinin2;

// 	switch (motorNo) {
// 		default:
// 			console.log("invalid motor! "+ motorNo);
// 			return;
// 		case 1:
// 			pinPwm = 2;
// 			pinin1 = 4;
// 			pinin2 = 3;
// 			break;
// 		case 2:
// 			pinPwm = 7;
// 			pinin1 = 6;
// 			pinin2 = 5;
// 			break;
// 	}

// 	var onValue = 4096;

// 	if (throttlePercent == 0) {
// 		sendPwm(pinPwm, 0, onValue);
// 		sendPwm(pinin1, 0, onValue);
// 		sendPwm(pinin2, 0, onValue);
// 	}else{

// 		if (direction >= 1) {
// 			//pwm.setPulseLength(pinin1, 0, onValue);
// 			//pwm.setPulseLength(pinin2, onValue, 0);
// 			sendPwm(pinin1, 0, onValue);
// 			sendPwm(pinin2, onValue, 0);
// 		} else {
// 			sendPwm(pinin1, onValue, 0);
// 			sendPwm(pinin2, 0, onValue);
// 		}

// 		var throttleValue = motorPwmOffset + (motorPwmRange*throttlePercent);
// 		console.log("motor "+motorNo+" throttle pwm value" +throttleValue);

// 		sendPwm(pinPwm, 0, throttleValue);
// 		//pwm.setPulseLength(pinPwm, 0, throttleValue);
// 	}
// }


function motorSetPercent(motorNo, direction, throttlePercent){
	let pinPwm, pinin1, pinin2;

	switch (motorNo) {
		default:
			console.log("invalid motor! "+ motorNo);
			return;
		case 1:
			pinPwm = 2;
			pinin1 = 4;
			pinin2 = 3;
			break;
		case 2:
			pinPwm = 7;
			pinin1 = 6;
			pinin2 = 5;
			break;
	}

	var onValue = 4095;

	if (throttlePercent == 0) {
		pwm.setPulseLength(pinPwm, 0, onValue);
		pwm.setPulseLength(pinin1, 0, onValue);
		pwm.setPulseLength(pinin2, 0, onValue);
	}else{

		if (direction >= 1) {
			pwm.setPulseLength(pinin1, 0, onValue);
			pwm.setPulseLength(pinin2, onValue, 0);
		} else {
			pwm.setPulseLength(pinin1, onValue, 0);
			pwm.setPulseLength(pinin2, 0, onValue);
		}

		var throttleValue = motorPwmOffset + (motorPwmRange*throttlePercent);
		console.log("motor "+motorNo+" throttle pwm value" +throttleValue);

		pwm.setPulseLength(pinPwm, 0, throttleValue);
	}
}

const webSocketServer = new WebSocket.Server({ noServer: true });

webSocketServer.on('connection', function connection(ws, req) {

	const ip = req.connection.remoteAddress;
	console.log('connection from ' + ip);

	ws.on('message', function incoming(message) {
		console.log('received: %s', message);
		
		let messageJson;
		try{
			messageJson = JSON.parse(message);
		}catch(err) {
			console.log('invalid json message');
			console.log(err);
			return;
		}
		if(!messageJson.action){
			console.log('invalid json message, missing action');
			return;
		}
		switch(messageJson.action){
			case "setShoot":
				if(!messageJson.hasOwnProperty('value')){
					console.log('invalid json message, missing value');
					return;
				}
				
				if(messageJson.value >= 1){
					console.log("FIRE!");
					pwm.setPulseLength(pwmShootChannel, 4096);
				}else{
					console.log("STOP FIRE!");
					pwm.setPulseLength(pwmShootChannel, 0);
				}

				break;
			case "setSteering":
				if(!messageJson.hasOwnProperty('value')){
					console.log('invalid json message, missing value');
					return;
				}
				steeringValue = parseInt(messageJson.value);

				break;
			case "setThrottle":
				if(!messageJson.hasOwnProperty('value')){
					console.log('invalid json message, missing value');
					return;
				}

				var throttleValue = messageJson.value;
				if (throttleValue > throttleMidpoint-throttleThreshold && throttleValue < throttleMidpoint+throttleThreshold) {

					console.log("setThrottle stop "+throttleValue);

					motorSetPercent(1, 0, 0);
					motorSetPercent(2, 0, 0);

				} else {

					//calc steering offset

					if (throttleValue >= 500) {
						//forward
						throttleValue = (throttleValue - 500) / 500;

						console.log("setThrottle fwd throttleValue = "+throttleValue );

						motorSetPercent(1, 1, throttleValue);
						motorSetPercent(2, 1, throttleValue);

					} else {
						//reverse
						throttleValue = (500 - throttleValue) / 500;

						console.log("setThrottle rev throttleValue = "+throttleValue );

						motorSetPercent(1, -1, throttleValue);
						motorSetPercent(2, -1, throttleValue);
					}
				}

				break;
			case "setTilt":
				if(!messageJson.hasOwnProperty('value')){
					console.log('invalid json message, missing value');
					return;
				}
				var servoPercent = messageJson.value / 1000;

				var servoValue = ServoRange * servoPercent + ServoMin;

				console.log('tilt pwm = '+servoValue);
				pwm.setPulseLength(pwmTiltChannel, servoValue);
				break;
			case "setPan":
				if(!messageJson.hasOwnProperty('value')){
					console.log('invalid json message, missing value');
					return;
				}
				var servoPercent = messageJson.value / 1000;

				var servoValue = ServoRange * servoPercent + ServoMin;

				console.log('pan pwm = '+servoValue);
				pwm.setPulseLength(pwmPanChannel, servoValue);
				break;
			default:
				console.log("invalid action!");
				return;
		}
	});

	ws.on('close', function clear() {
		console.log('connection closed for ' + ip);
	});

	ws.send('{"connected":1}');
});


// maps file extention to MIME types
const mimeType = {
	'.ico': 'image/x-icon',
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.eot': 'appliaction/vnd.ms-fontobject',
	'.ttf': 'aplication/font-sfnt'
};

const httpServer = http.createServer(function (req, res) {
	console.log(`${req.method} ${req.url}`);

	// parse URL
	const parsedUrl = url.parse(req.url);

	// extract URL path
	// Avoid https://en.wikipedia.org/wiki/Directory_traversal_attack
	// e.g curl --path-as-is http://localhost:9000/../fileInDanger.txt
	// by limiting the path to current directory only
	const sanitizePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
	let pathname = path.join(__dirname, 'webroot/', sanitizePath);

	fs.exists(pathname, function (exist) {
		if (!exist) {
			// if the file is not found, return 404
			res.statusCode = 404;
			res.end(`File ${pathname} not found!`);
			return;
		}

		// if is a directory, then look for index.html
		if (fs.statSync(pathname).isDirectory()) {
			pathname += '/index.html';
		}

		// read file from file system
		fs.readFile(pathname, function (err, data) {
			if (err) {
				res.statusCode = 500;
				res.end(`Error getting the file: ${err}.`);
			} else {
				// based on the URL path, extract the file extention. e.g. .js, .doc, ...
				const ext = path.parse(pathname).ext;
				// if the file is found, set Content-type and send data
				res.setHeader('Content-type', mimeType[ext] || 'text/plain');
				res.end(data);
			}
		});
	});


}).listen(httpPort);


httpServer.on('upgrade', function upgrade(request, socket, head) {
	const pathname = url.parse(request.url).pathname;

	if (pathname === '/wsapi') {
		webSocketServer.handleUpgrade(request, socket, head, function done(ws) {
			webSocketServer.emit('connection', ws, request);
		});
	} else {
		socket.destroy();
	}
});


// set-up CTRL-C with graceful shutdown
process.on("SIGINT", function () {
	console.log("\nGracefully shutting down from SIGINT (Ctrl-C)");

	pwm.dispose();

	process.exit(-1);
});
