/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console */

'use strict';

const fs = require('fs');
const express = require('express');
const spawn = require('child_process').spawn;
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 8080;

// Handler for CI.
function runLH(params, req, res, next) {
  const url = params.url;
  const format = params.output || params.format || 'html';
  const log = req.method === 'GET' && !('nolog' in params);

  if (!url) {
    res.status(400).send('Please provide a URL.');
    return;
  }

  const fileName = `report.${Date.now()}.${format}`;
  const outputPath = `./home/chrome/reports/${fileName}`;

  const args = [
    `--output-path=${outputPath}`,
    `--output=${format}`,
    '--port=9222',
    // Note: this is a noop when using Dockerfile.headful b/c Chrome is already
    // launched when the container starts up.
    `--chrome-flags="--headless"`,
  ];
  const child = spawn('lighthouse', [...args, url]);

  if (log) {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Keep connection open for streaming.
    });

    res.write(`
      <style>
        textarea {
          font: inherit;
          width: 100vw;
          height: 100vh;
          border: none;
          outline: none;
        }
        </style>
        <textarea>
    `);
  }

  child.stderr.on('data', data => {
    const str = data.toString();
    if (log) {
      res.write(str);
    }
    console.log(str);
  });

  // eslint-disable-next-line
  child.on('close', statusCode => {
    if (log) {
      res.write('</textarea>');
      res.write(`<meta http-equiv="refresh" content="0;URL='/${fileName}'">`);
      res.end();
    } else {
      res.sendFile(`/${outputPath}`, {}, err => {
        if (err) {
          next(err);
        }
        fs.unlink(outputPath); // delete report
      });
    }
  });
}

// Serve sent event handler.
function runLighthouseAsEventStream(req, res) {
  const url = req.query.url;
  const format = req.query.output || req.query.format || 'html';

  if (!url) {
    res.status(400).send('Please provide a URL.');
    return;
  }

  // Send headers for event-stream connection.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no', // Keep connection open for SSE.
  });

  const file = `report.${Date.now()}.${format}`;
  const fileSavePath = './home/chrome/reports/';

  const args = [
    `--output-path=${fileSavePath + file}`,
    `--output=${format}`,
    '--port=9222',
    // Note: this is a noop when using Dockerfile.headful b/c Chrome is already launched.
    `--chrome-flags="--headless"`,
  ];
  const child = spawn('lighthouse', [...args, url]);

  let log = '';

  child.stderr.on('data', data => {
    const str = data.toString();
    res.write(`data: ${str}\n\n`);
    log += str;
  });

  // eslint-disable-next-line
  child.on('close', statusCode => {
    const serverOrigin = `https://${req.host}/`;
    res.write(`data: done ${serverOrigin + file}\n\n`);
    res.status(410).end();
    console.log(log);
    log = '';
  });
}

const app = express();
app.use(bodyParser.json());
app.use(express.static('home/chrome/reports'));

app.get('/audit', (req, res, next) => {
  runLH(req.query, req, res, next);
});

app.post('/audit', (req, res, next) => {
  runLH(req.body, req, res, next);
});

app.get('/stream', (req, res, next) => {
  runLighthouseAsEventStream(req, res, next);
});

app.listen(PORT);
console.log(`Running on http://localhost:${PORT}`);