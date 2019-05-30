const express = require('express');
const elasticsearch = require('elasticsearch');
const uuidv4 = require('uuid/v4');
const winston = require('winston');
require('winston-logstash');

const app = express();
const client = new elasticsearch.Client({
  host: 'http://<ELASTICSEARCH_SERVER>:9200'
});

// adiciona logstash
winston.add(winston.transports.Logstash,
{
    port: 15517,
    host: '<LOGIT_SERVER>',
    ssl_enable: true,
    max_connect_retries: -1,
});

app.use(function(req, res, next) {
  winston.info(req.method + ' ' + req.url, req.headers);

  next();
});

app.get('/', (req, res) => {
	res.send(
    '<form action="/buscar">' +
    '<input type="text" name="busca"><br>' +
    '<input type="text" name="data" placeholder="YYYY-MM-DDTHH:MM"><br>' +
    '<button type="submit">Buscar</button>' + 
    '</form>'
  );
});

app.get('/buscar', (req, res) => {
  client.search({
    index: 'ponyfoo',
    type: 'article',
    body: {
      query: {
        bool: {
          filter: filtro(req.query.data),
          must: buscar(req.query)
        }
      }
    }
  }, (err, resp) => {
    res.send(hitsToHtml(resp.hits.hits));
  });
});

function buscar(query) {
  if (query.busca == null || query.busca == '') {
    return {match_all: {}};
  }

  return {
    multi_match: {
      query: query.busca,
      fields: ['title^3', 'body^2', 'tags']
    }
  };
}

function filtro(date) {
  var data = {bool: { must: [] }};

  if (date != null && date != '') {
    data.bool.must.push({
      range: {
        created: { gte: date } 
      }
    })
  }

  return data;
}

function hitsToHtml(hits) {
  return hits.map(hit => {
    return '<a href="/artigo/' + hit._id + '"><b>' + hit._source.title + '</b></a>' +
    '<p>ID: ' + hit._id + '</p>' +
    '<p>Score: ' + hit._score + '</p>' +
    '<p>Tags: ' + hit._source.tags + '</p>' +
    '<p>Data: ' + hit._source.created + '</p>' +
    '<p>' + hit._source.body + '</p>'
  }).join("<br>")
}

app.get('/criar', (req, res) => {
	res.send(
    '<form action="/salvar">' +
    '<input type="text" name="title" placeholder="Título"><br>' +
    '<input type="text" name="tags" placeholder="Tags"><br>' +
    '<textarea name="body" placeholder="Corpo do texto"></textarea><br>' +
    '<br><button type="submit">Salvar</button>' + '</form>'
  );
});

app.get('/salvar', (req, res) => {
  var id = req.query.id;

  if (id == null) {
    id = uuidv4();
  }

  var created = req.query.created;

  if (created == null) {
    created = new Date();
  }

  client.update({
    index: 'ponyfoo',
    type: 'article',
    id,
    body: {
      doc: {
        created: created,
        title: req.query.title,
        body: req.query.body,
        tags: req.query.tags
      },
      doc_as_upsert: true
    }
  }, (err, resp) => {
    res.send('Artigo criado com id ' + id + ' e título ' + req.query.title);
  });
});


app.get('/artigo/:id', (req, res) => {
  client.get({
    index: 'ponyfoo',
    type: 'article',
    id: req.params.id
  }, (err, resp) => {
    artigosRelacionados(resp._id).then((similares) => {
      res.send('<form action="/salvar">' +
    '<input type="hidden" name="id" value="' + resp._id + '">' +
    '<input type="hidden" name="created" value="' + resp._source.created + '">' +
    '<input type="text" name="title" value="' + resp._source.title + '"><br>' +
    '<input type="text" name="tags" value="' + resp._source.tags + '"><br>' +
    '<textarea name="body">' + resp._source.body + '</textarea><br>' +
    '<br><button type="submit">Salvar</button>' + '</form>' +
    '<br><br><h3>Artigos Relacionados:</h3><br>' +
    hitsToHtml(similares.hits.hits)
    );
    })
  });
});

function artigosRelacionados(id) {
  return client.search({
    index: 'ponyfoo',
    type: 'article',
    body: {
      query: {
        bool: {
          must: {
            more_like_this: {
              like: {
                _id: id.toString()
              },
              min_term_freq: 1,
              min_doc_freq: 1
            }
          }
        }
      },
      size: 2
    }
  });
}

app.listen(3000, () => console.log('server started'));
