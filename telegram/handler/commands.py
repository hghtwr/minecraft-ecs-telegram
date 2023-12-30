import json
import os
import telebot
import logging
import boto3

bot = telebot.TeleBot(os.environ.get('TELEGRAM_API_TOKEN'), threaded=False)
logger = telebot.logger
telebot.logger.setLevel(logging.DEBUG) # Outputs debug messages to console.

@bot.message_handler(func=lambda message: message.chat.id != int(os.environ.get('TELEGRAM_CHAT_ID')))
def handle_unknown_chat(message):
    bot.reply_to(message, "Sorry, I don't know you")

@bot.message_handler(commands=['start'])
def start_ecs_service(message):
    ecs_service_name = os.environ.get('ECS_SERVICE_NAME')
    print("start command called")
    # Scale ECS Service
    try:
      response = boto3.client('ecs').update_service(
          cluster=os.environ.get('ECS_CLUSTER_NAME'),
          service=ecs_service_name,
          desiredCount=1)
      bot.reply_to(message, "Starting server... \n This might take up to 5 minutes")
    except Exception as e:
      bot.reply_to(message, "Error starting server: " + str(e))
      return

@bot.message_handler(commands=['stop'])
def stop_ecs_service(message):
    ecs_service_name = os.environ.get('ECS_SERVICE_NAME')
    print("start command called")
    # Scale ECS Service
    try:
      response = boto3.client('ecs').update_service(
          cluster=os.environ.get('ECS_CLUSTER_NAME'),
          service=ecs_service_name,
          desiredCount=0)
      bot.reply_to(message, "Stopping server...")
    except Exception as e:
      bot.reply_to(message, "Error stopping server: " + str(e))
      return

@bot.message_handler(commands=['status'])
def ecs_service_status(message):
    task_ips = get_task_ips()

    if len(task_ips) > 0:
        bot.reply_to(message, "Server IP: " + task_ips[0])
    else:
        bot.reply_to(message, "Server seems not be running or misconfigured")

# Handle all other messages
@bot.message_handler(func=lambda message: True, content_types=['text'])
def echo_message(message):
    bot.reply_to(message, message.text)


def lambda_handler(event, context):
    # Process event from aws and respond
    process_event(event)
    return {
        'statusCode': 200
    }



def get_task_ips():
    try:
      cluster_name = os.environ.get('ECS_CLUSTER_NAME')
      ecs_client = boto3.client('ecs')
      task_ids = ecs_client.list_tasks(cluster=cluster_name, desiredStatus='RUNNING')['taskArns']
      if len(task_ids) == 0:
          return []
      else:
        described_tasks = ecs_client.describe_tasks(cluster=cluster_name, tasks=task_ids)
        eni_ids = []
        for task in described_tasks['tasks']:
            for attachment in task.get('attachments', []):
                for detail in attachment.get('details', []):
                    if detail['name'] == 'networkInterfaceId':
                        eni_ids.append(detail['value'])
        public_ips = []
        for eni_id in eni_ids:
            eni = boto3.resource('ec2').NetworkInterface(eni_id)
            public_ips.append(eni.association_attribute['PublicIp'])
        return public_ips
    except Exception as e:
      return "Error fetching IP: " + str(e)

def process_event(event):
    # Get telegram webhook json from event
    request_body_dict = json.loads(event['body'])
    # Parse updates from json
    update = telebot.types.Update.de_json(request_body_dict)
    # Run handlers and etc for updates
    bot.process_new_updates([update])