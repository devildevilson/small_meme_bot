require("dotenv").config();
const levenshtein = require('js-levenshtein');
const wikipedia = require("@dada513/wikipedia-search");
const math = require("mathjs");
const tr = require("transliteration");
const dic = require("urban-dictionary");
const axios = require("axios");

const fastify = require("fastify")();

const telegram_api_send_url = `https://api.telegram.org/bot${process.env.TELEGRAM_API_TOKEN}/sendMessage`;

function perf(msg, func, ...args) {
  const start_time = performance.now();
  try {
    const ret = func(...args);
    return ret;
  } finally {
    const end_time = performance.now();
    console.info(`${msg} took ${end_time - start_time} milliseconds`);
    //logger.info(`${msg} took ${end_time - start_time} milliseconds`);
  } 
}

async function aperf(msg, func, ...args) {
  const start_time = performance.now();
  try {
    const ret = await func(...args);
    return ret;
  } finally {
    const end_time = performance.now();
    console.info(`${msg} took ${end_time - start_time} milliseconds`);
    //logger.info(`${msg} took ${end_time - start_time} milliseconds`);
  } 
}

function rnd_int(min, max) {
  return Math.floor((Math.random() * (max - min)) + min);
}

function dice(count, bound) {
  let summ = 0;
  for (let i = 0; i < count; ++i) {
    summ += rnd_int(1, bound);
  }
  return summ;
}

// как посчитаем это дело? рекурсия

function compute_expr(obj) {
  if (obj instanceof math.ConstantNode) return obj.value;

  if (
    obj instanceof math.OperatorNode && 
    obj.op === "*" && 
    obj.implicit && 
    obj.args[0] instanceof math.ConstantNode &&
    obj.args[1] instanceof math.SymbolNode && 
    obj.args[1].name.trim()[0] === "d"
  ) {
    // это скорее всего запись вида '1d4'
    const symbol_part = obj.args[1].name.trim().substring(1);
    const dice_value = parseInt(symbol_part);
    if (isNaN(dice_value)) throw `Could not parse symbol node '${obj.args[1].name}' in expression`;
    if (dice_value < 2) throw `Invalid dice expression '${obj.args[1].name}'`;
    const dice_count = obj.args[0].value;
    if (dice_count < 1) throw `Invalid dice count value '${dice_count}'`;
    return dice(dice_count, dice_value);
  }

  if (obj instanceof math.SymbolNode) {
    const n = obj.name.trim();
    if (n[0] !== 'd') throw `Bad dice expression '${obj.name}'`;
    const symbol_part = n.substring(1);
    const dice_value = parseInt(symbol_part);
    if (isNaN(dice_value)) throw `Could not parse symbol node '${obj.args[1].name}' in expression`;
    if (dice_value < 2) throw `Invalid dice expression '${obj.args[1].name}'`;
    return dice(1, dice_value);
  }

  if (obj instanceof math.ParenthesisNode) return compute_expr(obj.content);

  if (!(obj instanceof math.OperatorNode)) {
    console.log(obj);
    throw `wtf`;
  }

  const val1 = compute_expr(obj.args[0]);
  const arr = obj.args.slice(1);

  let ret = 0;
  switch (obj.op) {
    case '*': ret = arr.reduce((accum, val) => accum * compute_expr(val), val1); break;
    case '/': ret = arr.reduce((accum, val) => accum / compute_expr(val), val1); break;
    case '+': ret = arr.reduce((accum, val) => accum + compute_expr(val), val1); break;
    case '-': ret = arr.reduce((accum, val) => accum - compute_expr(val), val1); break;
    case '%': ret = arr.reduce((accum, val) => accum % compute_expr(val), val1); break;
    default: throw `New operator '${obj.op}'`;
  }

  return ret;
}

// perf("test", () => { 
//   const abc = math.parse("(2d4 + 1) * 1d20");
//   // console.log(abc);
//   // console.log(abc instanceof math.OperatorNode);
//   // console.log(abc.args[0].content.args[0].args);
//   const val = compute_expr(abc);
//   console.log(val);
// });

const digit_regex = /[0-9]+/g;

async function parse_msg(msg) {
  console.log(msg);
  // теперь тут у нас два варианта: 
  // либо тут может придти команда
  // либо приходит одно сообщение
  // команда обязательно начинается с '/' и содержит английское название
  // нужно в ответном сообщении что то посчитать
  // если приходит сообщение то мы можем на него как то мемно ответить
  // шанс взять сообщение вообще 1% ???
  // как мемно отвечаем? есть несколько способов
  // 1. есть список слов на которые реагируем отвечая каким то мемом (низкий шанс, но наверное на этот список лучше проверять каждое сообщение)
  // 2. может быть небольшой мем + анекдот (шанс чуть выше)
  // 3. пытаемся отыскать какие то поехавшие совпадения в википедии (наверное самый большой шанс)
  // да имеет смысл добавить к этому списку что то еще
  // на счет 3. из длинного сообщения пытаемся взять несколкьо слов идущих подряд
  // загуглить их в википедии + мы можем взять транслитерацию и ее попробовать найти
  // 
  // так еще было бы неплохо брать смешнявку из реддита, но там придется получать картинку или даже видос и сгружать его в телегу

  if (!msg.message && !msg.message.text) return;

  const chat_id = msg.message.chat.id;
  const msg_text = msg.message.text;
  const first_word = msg_text.split(" ")[0].trim();
  if (first_word[0] === "/") {
    // это команда
    if (first_word !== "/roll") return; // пока что только одна
    const msg_rest = msg_text.split(" ").slice(1).join(" ").trim();
    let val = 0;
    if (digit_regex.test(msg_rest)) {
      // если перед нами просто число, то возьмем от нуля до него
      const num = parseInt(msg_rest);
      if (isNaN(num)) return;
      val = rnd_int(0, num);
    } else {
      const math_obj = math.parse(msg_rest);
      val = compute_expr(math_obj);
    }

    const ret = await axios.post(telegram_api_send_url, {
      chat_id,
      text: `Your number is ${val}`,
      reply_parameters: { message_id: msg.message.message_id }
    });
    return;
  }

  // если это не команда, то пока оставим как есть
}

fastify.after(() => {
  fastify.route({
    method: 'POST',
    path: '/',
    handler: async (request, reply) => {
      parse_msg(request.body);
      return "Ok";
    },
    schema: {
      body: {
        type: "object"
      }
    }
  });
});

(async () => {
  console.log("Starting");
  try {
    await fastify.listen({ 
      port: process.env.SERVER_PORT,
      host: process.env.SERVER_HOST, 
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
})();

// что нужно: 1) /roll + еще парочка команд, что нибудь относительно простое
// 2) брать некоторые ключевые слова и выдавать в ответ что нибудь мемное:
// а) иди нахуй + пидарас + проч генерят что нибудь забавное
// б) некая связка слов или несколько скобочек '(((' могут например стриггерить его рассказать анекдот
// в) ???
// 3) изучить сообщение и попробовать найти какую нибудь статейку на вики
// + нужно поизучать реддит апи