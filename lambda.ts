import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";


interface LambdaOptions  {
  readinessLogGroup: string | pulumi.Output<string>;
  ecsClusterName?: string | pulumi.Output<string>;
  ecsServiceName?:  string | pulumi.Output<string>;
}

class McLambda extends pulumi.ComponentResource {
    private readonly region: Promise<string>;
    private readonly accountId: Promise<string>;
    public readonly lambdaOptions: LambdaOptions;
    public readonly iamRole: aws.iam.Role;
    public readonly readinessHandler: aws.lambda.Function;
    public readonly commandHandler: aws.lambda.Function;
    public readonly stoppedHandler: aws.lambda.Function;
    public readonly dependencyLayer: aws.lambda.LayerVersion;
    public readonly readinessLogSubscriptionFilter: aws.cloudwatch.LogSubscriptionFilter;
    public readonly stoppedLogSubscriptionFilter: aws.cloudwatch.LogSubscriptionFilter;
    public readonly allowCloudWatchReadiness: aws.lambda.Permission;
    public readonly allowCloudWatchStopped: aws.lambda.Permission;
    public readonly commandHandlerFunctionUrl: aws.lambda.FunctionUrl;

    constructor(name: string, args: LambdaOptions, opts?: pulumi.ComponentResourceOptions) {
        super("awsmc:lambda:" + name, name, args, opts);

        this.region = aws.getRegion({}).then(region => region.name);
        this.accountId = aws.getCallerIdentity({}).then(identity => identity.accountId);

        let defaultOptions: LambdaOptions = {
          readinessLogGroup: name,
          ecsClusterName: name
        };

        this.lambdaOptions = Object.assign(defaultOptions, args);


        // Create a Lambda function that will be invoked by the API Gateway.
        this.iamRole = new aws.iam.Role("lambda-execution-role", {
          namePrefix: "awsmc-lambda-",
          description: "Execution role for aws minecraft lambda function",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          inlinePolicies: [{
            name: "mc-taskrole-lambda-logs",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: "logs:CreateLogGroup",
                  Resource: pulumi.interpolate `arn:aws:logs:*:log-group:/aws/lambda/*:*`
                },
                {
                  Effect: "Allow",
                  Action: [
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                  ],
                  Resource: [
                   pulumi.interpolate `arn:aws:logs:*:log-group:/aws/lambda/*:*`
                  ]
                }
              ]
          })
        }, {
          name: "mc-taskrole-lambda-url-invocation",
          policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: "lambda:InvokeFunctionUrl",
                Resource: pulumi.interpolate `arn:aws:lambda:${this.region}::function:`,
                Condition: {
                  "StringEquals": {
                    "lambda:FunctionUrlAuthType": "NONE"
                  }
                }
              }
            ]
          })
        }, {
          name: "mc-taskrole-lambda-ecs",
          policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",

                Action: [
                  "ecs:Describe*",
                  "ecs:List*",
                  "ecs:UpdateService",
                ],
                Resource: pulumi.interpolate `arn:aws:ecs:${this.region}:${this.accountId}:*`
              }
            ]
          })
        },{
          name: "mc-taskrole-lambda-ec2",
          policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",

                Action: [
                  "ec2:DescribeNetworkInterfaces"
                ],
                Resource: "*"
              }
            ]
          })
        }, {
          name: "mc-taskrole-lambda-ecs-readiness",
          policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ecs:ListTasks",
                ],
                Resource: "*",
                Condition: {
                  "StringEquals": {
                    "ecs:cluster": pulumi.interpolate `arn:aws:ecs:${this.region}:${this.accountId}:cluster/${this.lambdaOptions.ecsClusterName}`
                  }
                }
              }
            ]
          })
        }],
          assumeRolePolicy: {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Principal: {
                        Service: "lambda.amazonaws.com"
                    },
                    Action: "sts:AssumeRole"
                }
            ]
        }
        }, { parent: this});

        this.dependencyLayer = new aws.lambda.LayerVersion("dependencyLayer", {
          layerName: name,
          compatibleRuntimes: ["python3.12"],
          code: new pulumi.asset.FileArchive("./telegram/handler/layer/dependencies.zip"),
        }, { parent: this});



        this.commandHandler = new aws.lambda.Function("commandHandler", {
          runtime: "python3.12",
          description: name,
          role: this.iamRole.arn,
          handler: "commands.lambda_handler",
          code: new pulumi.asset.FileArchive("./telegram/handler/commands.zip"),
          layers: [this.dependencyLayer.arn],
          timeout: 60,
          environment: {
            variables: {
              "TELEGRAM_API_TOKEN" : process.env.TELEGRAM_API_TOKEN || "",
              "TELEGRAM_CHAT_ID" : process.env.TELEGRAM_CHAT_ID || "",
              "ECS_CLUSTER_NAME" : this.lambdaOptions.ecsClusterName || "",
              "ECS_SERVICE_NAME" : this.lambdaOptions.ecsServiceName || ""
            }
          },
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          }, { parent: this, dependsOn: [this.dependencyLayer]});

          this.commandHandlerFunctionUrl = new aws.lambda.FunctionUrl("commandHandlerUrl", {
            functionName: this.commandHandler.name,
            authorizationType: "NONE", // Can be "AWS_IAM" for IAM-based authorization or "NONE" for open access
          }, { parent: this, dependsOn: [this.commandHandler]});

        this.readinessHandler = new aws.lambda.Function("readinessHandler", {
          runtime: "python3.12",
          description: name,
          role: this.iamRole.arn,
          handler: "ready.lambda_handler",
          timeout: 60,
          code: new pulumi.asset.FileArchive("./telegram/handler/ready.zip"),
          layers: [this.dependencyLayer.arn],
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },

          environment: {
            variables: {
              "TELEGRAM_API_TOKEN" : process.env.TELEGRAM_API_TOKEN || "",
              "TELEGRAM_CHAT_ID" : process.env.TELEGRAM_CHAT_ID || "",
              "ECS_CLUSTER_NAME" : this.lambdaOptions.ecsClusterName || "",
              "ECS_SERVICE_NAME" : this.lambdaOptions.ecsServiceName || ""
            }
          }
          }, { parent: this, dependsOn: [this.dependencyLayer]});


          this.stoppedHandler = new aws.lambda.Function("stoppedHandler", {
            runtime: "python3.12",
            description: name,
            role: this.iamRole.arn,
            handler: "stopped.lambda_handler",
            timeout: 60,
            code: new pulumi.asset.FileArchive("./telegram/handler/stopped.zip"),
            layers: [this.dependencyLayer.arn],
            tags: {
              "pulumi-name": name,
              "created-by": "pulumi",
              "service": "awsmc"
            },

            environment: {
              variables: {
                "TELEGRAM_API_TOKEN" : process.env.TELEGRAM_API_TOKEN || "",
                "TELEGRAM_CHAT_ID" : process.env.TELEGRAM_CHAT_ID || "",
                "ECS_CLUSTER_NAME" : this.lambdaOptions.ecsClusterName || "",
                "ECS_SERVICE_NAME" : this.lambdaOptions.ecsServiceName || ""
              }
            }
            }, { parent: this, dependsOn: [this.dependencyLayer]});

          const lambdaInvokePolicy = new aws.iam.RolePolicy("lambdaInvokePolicy", {
            namePrefix: "mc-taskrole-lambda-invoke-policy-",
            role: this.iamRole.id,
            policy: {
              Version: "2012-10-17",
              Statement: [
                {
                  Action: ["lambda:InvokeFunction"],
                  Effect: "Allow",
                  Resource: [this.readinessHandler.arn, this.stoppedHandler.arn],
                },
              ],
            },
          }, { parent: this, dependsOn: [this.readinessHandler]});

          this.allowCloudWatchReadiness = new aws.lambda.Permission("allowCloudWatchReadiness", {
            action: "lambda:InvokeFunction",
            function: this.readinessHandler.name,
            principal: "logs.amazonaws.com",
            sourceAccount: this.accountId,
            sourceArn: pulumi.interpolate `arn:aws:logs:${this.region}:${this.accountId}:log-group:${this.lambdaOptions.readinessLogGroup}:*`
          }, { parent: this, dependsOn: [this.readinessHandler]});

          this.allowCloudWatchStopped = new aws.lambda.Permission("allowCloudWatchStopped", {
            action: "lambda:InvokeFunction",
            function: this.stoppedHandler.name,
            principal: "logs.amazonaws.com",
            sourceAccount: this.accountId,
            sourceArn: pulumi.interpolate `arn:aws:logs:${this.region}:${this.accountId}:log-group:${this.lambdaOptions.readinessLogGroup}:*`

          }, { parent: this, dependsOn: [this.readinessHandler]});



        this.readinessLogSubscriptionFilter = new aws.cloudwatch.LogSubscriptionFilter("readinessLogSubscriptionFilter", {
          logGroup: this.lambdaOptions.readinessLogGroup,
          filterPattern: "%RCON running on 0\\.0\\.0\\.0:25575%",
          destinationArn: this.readinessHandler.arn,
          }, { parent: this, dependsOn: [this.readinessHandler, this.allowCloudWatchReadiness]});

        this.stoppedLogSubscriptionFilter = new aws.cloudwatch.LogSubscriptionFilter("stoppedLogSubscriptionFilter", {
            logGroup: this.lambdaOptions.readinessLogGroup,
            filterPattern: "%Thread RCON Listener stopped%",
            destinationArn: this.stoppedHandler.arn,
            }, { parent: this, dependsOn: [this.stoppedHandler, this.allowCloudWatchStopped]});

    }
}

export { McLambda, LambdaOptions}