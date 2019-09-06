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
	address: 0x40,
	frequency: 50
	//debug: true
};


var pwmPanChannel = 1;
var pwmFireChannel = 14;

var pwm = new pca9685.Pca9685Driver(options, function startLoop(err) {
	if (err) {
		console.error("Error initializing PCA9685");
		process.exit(-1);
	}

	console.log("PCA9685 Initialized");
});

pwm.setPulseLength(pwmPanChannel, 800);




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
			case "updateSteering":
				if(!messageJson.value){
					console.log('invalid json message, missing value');
					return;
				}
				let pwmValue = Math.round(800 + (1400 * (parseInt(messageJson.value)/1000)));
				console.log('update steering = '+messageJson.value+' / pwm '+pwmValue);
				
				pwm.setPulseLength(pwmPanChannel, pwmValue);

				break;
				
			case "updateThrottle":
				if(!messageJson.value){
					console.log('invalid json message, missing value');
					return;
				}
				if(messageJson.value >= 960){
					console.log("FIRE!");
					pwm.setPulseLength(pwmFireChannel, 4096);
				}else{
					console.log("STOP FIRE!");
					pwm.setPulseLength(pwmFireChannel, 0);
				}
				break;
			default:
				console.log("invalid action!");
				return;
		}
	});

	ws.on('close', function clear() {
		console.log('connection closed for ' + ip);
	});

	ws.send('something');
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
