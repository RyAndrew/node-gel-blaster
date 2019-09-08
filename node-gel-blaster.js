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

var throttleThreshold = 60.0
var throttleMidpoint = 500.0

var motorPercentMin = 0.2; // 20% pwm duty cycle for minimum motor movement
//var motorPwmMax = 4095
//var motorPwmRange = 1000.0
//var motorPwmOffset = motorPwmMax - motorPwmRange

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

	var onValue = 4096;
	console.log("throttlePercent = "+(throttlePercent*100));
	if (throttlePercent == 0) {

		pwm.channelOff(pinin1);
		pwm.channelOff(pinin2);
		pwm.channelOff(pinPwm);
	}else{

		if (direction >= 1) {
			pwm.channelOn(pinin2);
			pwm.channelOff(pinin1);
		} else {
			pwm.channelOff(pinin2);
			pwm.channelOn(pinin1);
		}

		throttlePercent = motorPercentMin + throttlePercent;
		console.log("motor "+motorNo+" throttle % = " + throttlePercent);
		pwm.setDutyCycle(pinPwm, throttlePercent);
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
					pwm.channelOn(pwmShootChannel);
				}else{
					console.log("STOP FIRE!");
					pwm.channelOff(pwmShootChannel);
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
