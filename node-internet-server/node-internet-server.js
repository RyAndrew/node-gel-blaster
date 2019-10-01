"use strict";

const WebSocket = require('ws');

const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { spawn } = require('child_process');

const httpPort = 8055;
const httpVideoStreamKey = 'supersecret';

var controlConnectionWebSocket = null;

var videoServerConnectionCount = 0;
var audioServerConnectionCount = 0;

const webSocketServer = new WebSocket.Server({ noServer: true });

webSocketServer.on('controlconnection', function connection(ws, req) {

	const ip = req.connection.remoteAddress;
	console.log('controlconnection from ' + ip);

	controlConnectionWebSocket = ws;
	
	ws.on('message', function(message){
		console.log('controlconnection message ',message);
	});

	ws.on('close', function clear() {
		console.log('controlconnection closed for ' + ip);
	});

	ws.send('{"controlconnected":true}');
});
webSocketServer.on('connection', function connection(ws, req) {

	const ip = req.connection.remoteAddress;
	console.log('connection from ' + ip);

	ws.on('message', function(message){
	 	handleIncomingControlMessage(ws, message);
	});

	ws.on('close', function clear() {
		console.log('connection closed for ' + ip);
	});

	ws.send('{"connected":true}');
});

function handleIncomingControlMessage(ws, message) {
	console.log('control, revc: "%s"', message);
	
	let messageJson;
	try{
		messageJson = JSON.parse(message);
	}catch(err) {
		console.log('control,invalid json message');
		return;
	}
	if(!messageJson.action){
		console.log('control, invalid json message, missing action');
		return;
	}

	if(controlConnectionWebSocket !== null){
		controlConnectionWebSocket.send(message);
	}

};


const videoServer = new WebSocket.Server({ noServer: true });
videoServer.on('connection', function(socket, upgradeReq) {
	videoServerConnectionCount++;
	console.log(
		'New Video Viewer Connection: ', 
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'('+videoServerConnectionCount+' total)'
	);
	socket.on('close', function(code, message){
		videoServerConnectionCount--;
		console.log(
			'Disconnected Video WebSocket ('+videoServerConnectionCount+' total)'
		);
	});
});
function broadcastVideoData(data) {
	videoServer.clients.forEach(function each(clientSocket) {
		if (clientSocket.readyState === WebSocket.OPEN) {
			clientSocket.send(data);
		}
	});
}

const audioServer = new WebSocket.Server({ noServer: true });
audioServer.on('connection', function(socket, upgradeReq) {
	audioServerConnectionCount++;
	console.log(
		'New Audio Viewer Connection: ', 
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'('+audioServerConnectionCount+' total)'
	);
	socket.on('close', function(code, message){
		audioServerConnectionCount--;
		console.log(
			'Disconnected Audio WebSocket ('+audioServerConnectionCount+' total)'
		);
	});
});
function broadcastAudioData(data) {
	audioServer.clients.forEach(function each(clientSocket) {
		if (clientSocket.readyState === WebSocket.OPEN) {
			clientSocket.send(data);
		}
	});
}


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
	console.log(`parsedUrl.pathname = ${parsedUrl.pathname}`);

	// if(parsedUrl.pathname == '/viewVideo'){
	// 	const parsedUrl = url.parse(req.url);
	// 	console.log(log.query);
		
	// 	return;
	// }
	if(parsedUrl.pathname.indexOf('/sendVideo') != -1){

		var error = true, errorDescription = 'missing streamKey parameter';

		if(parsedUrl.query !== null ){
			var parsedQuery = querystring.parse(parsedUrl.query);

			if( parsedQuery.streamKey && parsedQuery.streamKey === httpVideoStreamKey){
				error = false;
			}else{
				errorDescription = 'wrong streamKey parameter';
			}
		}
		if(error === true){
			console.log(`Failed Stream Connection: ${req.socket.remoteAddress}:${req.socket.remotePort} ${errorDescription}`);
			res.end();
			return;
		}
	
		res.connection.setTimeout(0);
		console.log(
			'Incoming Video Stream Connected: ' + 
			req.socket.remoteAddress + ':' +
			req.socket.remotePort
		);
		req.on('data', function(data){
			broadcastVideoData(data);
		});
		req.on('end',function(){
			console.log('sendVideo client closed');
		});

		return;
	}


	if(parsedUrl.pathname.indexOf('/sendAudio') != -1){

		var error = true, errorDescription = 'missing streamKey parameter';

		if(parsedUrl.query !== null ){
			var parsedQuery = querystring.parse(parsedUrl.query);

			if( parsedQuery.streamKey && parsedQuery.streamKey === httpVideoStreamKey){
				error = false;
			}else{
				errorDescription = 'wrong streamKey parameter';
			}
		}
		if(error === true){
			console.log(`Failed Stream Connection: ${req.socket.remoteAddress}:${req.socket.remotePort} ${errorDescription}`);
			res.end();
			return;
		}
	
		res.connection.setTimeout(0);
		console.log(
			'Incoming Audio Stream Connected: ' + 
			req.socket.remoteAddress + ':' +
			req.socket.remotePort
		);
		req.on('data', function(data){
			broadcastAudioData(data);
		});
		req.on('end',function(){
			console.log('sendAudio client closed');
		});

		return;
	}


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

	switch(pathname){
		case '/control': 
			webSocketServer.handleUpgrade(request, socket, head, function done(ws) {
				webSocketServer.emit('controlconnection', ws, request);
			});
			break;
		case '/wsapi': 
			webSocketServer.handleUpgrade(request, socket, head, function done(ws) {
				webSocketServer.emit('connection', ws, request);
			});
			break;
		case '/viewVideo': 
			videoServer.handleUpgrade(request, socket, head, function done(ws) {
				videoServer.emit('connection', ws, request);
			});
			break;
		case '/viewAudio': 
			audioServer.handleUpgrade(request, socket, head, function done(ws) {
				audioServer.emit('connection', ws, request);
			});
			break;
		default:
			socket.destroy();
	}
});


// set-up CTRL-C with graceful shutdown
process.on("SIGINT", function () {
	console.log("\nGracefully shutting down from SIGINT (Ctrl-C)");

	process.exit(-1);
});
