import json
import os
import telebot
import logging
import boto3
bot = telebot.TeleBot(os.environ.get('TELEGRAM_API_TOKEN'), threaded=False)
logger = telebot.logger
telebot.logger.setLevel(logging.DEBUG) # Outputs debug messages to console.


def lambda_handler(event, context):
    # Process event from aws and respond
    bot.send_message(os.environ.get('TELEGRAM_CHAT_ID'), "Server was stopped")

    return {
        'statusCode': 200
    }