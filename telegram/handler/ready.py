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
    bot.send_message(os.environ.get('TELEGRAM_CHAT_ID'), "Server is ready on " + get_task_ips()[0])

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
