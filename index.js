const _ = require('underscore');
const async = require('async');
const express = require('express');
const bodyParser = require('body-parser');
const child_process = require('child_process');
const mongodb = require('mongodb');
const { ObjectId, MongoClient } = mongodb;
const mongoUrl = 'mongodb://localhost:27017/';

const axios = require('axios');

const line_token = process.env.line_token;
const line = axios.create({
  baseURL: 'https://api.line.me/v2/bot/message/reply',
  headers: { 'Authorization': ['Bearer', line_token].join(' ') }
});

const google_apikey = process.env.google_apikey;
const google_engine = process.env.google_engine;
const google = axios.create({
  baseURL: 'https://www.googleapis.com/customsearch/v1',
  params: {
    key: google_apikey,
    cx: google_engine,
    alt: 'json',
    start: 1
  }
});


const appGlobal = {};
function collection(name) {
  return appGlobal.db.db('rapper').collection(name);
}

process.env.PORT = process.env.PORT || 8000;


const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

function resolve(keyword, callback) {
  crawl(keyword, function(err, rawdata) {

    const snippets = _.uniq(rawdata)
      .map(snippet => snippet.replace(/\n/g, ''))
      .map(snippet => snippet.replace(/"/g, "'"));

    const command = `ruby ./rhymer.rb "${snippets.join(' ')}"`;
    child_process.exec(command, (err, items) => {
      if (err) {
        callback(err);
      } else {
        const result = select(items.split('\n'), 40);
        callback(err, result);
      }
    });

  });
}

function crawl(keyword, callback) {
  const colls = collection('snippets');
  const keywords = keyword.replace(/[ \t\n]+/g, ' ').split(' ').sort();
  colls.findOne({ keywords: { $eq: keywords } }, (err, result) => {
    if (result) {
      callback(null, result.rawdata);
    } else {
      const config = {
        params: {
          q: keywords.join(' '),
          key: google_apikey,
          cx: google_engine,
          alt: 'json',
          start: 1
        }
      };
      console.log(`Google search : ${config.params.q}`);
      google.get('', config).then((google_result) => {
        const rawdata = google_result.data.items
          .map(item => item.snippet);

        const record = {
          rawdata,
          createdAt: new Date(Date.now()),
          keywords,
        };
        console.log(rawdata);
        colls.insert(record, (err) => {
          callback(err, rawdata);
        });
      }).catch(err => {
        callback(err);
      });
    }
  })
}

// 文字列の長さの差
function dist(array) {
  return Math.abs(array[0].length - array[1].length);
}

// 短いやつからn個選ぶ
function select(array, n) {
  const tmp1 = array.map(item => {
    const items = item.split(' ').sort();
    return { item: items.join(' '), length: item.length, items }
  });

  // 前後の文字数の差が大きい回答は除く
  const tmp2 = tmp1.filter(x => 1 < x.length)
    .filter(x => 10 > dist(x.items))
    .sort((x1, x2) => x1.length - x2.length);

  const result = _.uniq(tmp2.map(item => item.item));

  return result.slice(0, n);
}

function randomChoice(array, n) {
  let result = [];
  for (let i = 0; i < n; i++) {
    let index = Math.floor(Math.random() * array.length);
    result.push(array[index]);
    array.splice(index, 1);
  }
  return result;
}

app.get('/', (req, res) => {
  const data = {
    healthcheck: true
  };
  res.send(data);
});

app.post('/', (req, res) => {

    //req.body = JSON.parse("{\"events\":[{\"type\":\"message\",\"replyToken\":\"d259afed4c0f40049acc5c71c2ce5308\",\"source\":{\"userId\":\"U6368a072867667156b52ac8a5327ceac\",\"type\":\"user\"},\"timestamp\":1487385744448,\"message\":{\"type\":\"text\",\"id\":\"5663813917960\",\"text\":\"アップルストア\"}}]}");

    console.log(JSON.stringify(req.body));

    if (req.body && req.body.events) {
      const event = req.body.events[0];

      const events = collection('events');

      async.waterfall([
        function(next) {
          const keyword = event.message ? event.message.text : '';

          // . なら、直前の繰り返し
          if (keyword === '.') {
            events.findOne({ _id: event.source.userId }, function(err, result) {
              next(err, result ? result.message.text : keyword);
            });
          } else {
            event.timestamp = new Date(event.timestamp);
            events.update({ _id: event.source.userId }, event, { upsert: true }, function(err) {
              next(err, keyword);
            });
          }
        },

        function(keyword, next) {
          console.log(keyword);
          resolve(keyword, (err, snipets) => {
            next(err, snipets);
          });
        },

        function(snipets, next) {
          const replyToken = event.replyToken;

          const result = randomChoice(snipets, 3).map(text => `「${text}」`);

          let reply = [];
          reply.push('Hey!! Yo!!');
          reply = reply.concat(result);
          reply.push('Type "." for more!! Yeah!!');

          console.log(reply);

          const messages = reply.map(text => {
            return { type: "text", text }
          });

          const body = { replyToken, messages };

          line.post('', body).then(() => {
            next();
          }).catch(err => {
            next(err);
          });
        }
      ], function(err) {
        res.sendStatus(err ? 400 : 200);
      });
    } else {
      res.sendStatus(400);
    }
  }
);


MongoClient.connect(mongoUrl, (err, db) => {
  if (err) {
    console.log(err);
  } else {
    appGlobal.db = db;

    app.listen(process.env.PORT, () => {
      console.log(`Rapper app listening on port ${process.env.PORT}!`);
    });
  }
});

