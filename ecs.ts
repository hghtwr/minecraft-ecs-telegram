

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
interface McEcsOptions {

  image?: string;
  cpu?: number;
  memory?: number;
  azName?: string; // Selected randomly if not specified,
  useSpotInstance?: boolean;
  serverProperties: {
    MODT?: string;
    DIFFICULTY?: string;
    GAME_MODE?: string;
    ONLINE_MODE?: string;
    SERVER_NAME?: string;
    MAX_PLAYERS?: string;
    VERSION?: string;
  }
}

class McEcs extends pulumi.ComponentResource {

  public readonly mcEcsOptions: McEcsOptions;
  private readonly efs: aws.efs.FileSystem;
  private readonly accessPoint: aws.efs.AccessPoint;
  private readonly securityGroup: aws.ec2.SecurityGroup;
  private readonly cluster: aws.ecs.Cluster;
  private readonly taskDefinition: aws.ecs.TaskDefinition;
  private readonly taskRole: aws.iam.Role;
  private readonly securityGroupEgressRule: aws.vpc.SecurityGroupEgressRule;
  private readonly securityGroupIngressRules: aws.vpc.SecurityGroupIngressRule[];
  private readonly efsBackupPolicy: aws.efs.BackupPolicy;
  private service?: aws.ecs.Service;
  private mountTarget?: aws.efs.MountTarget;
  private readonly name: string;
  private readonly azName: Promise<string>;




  constructor(name: string, args: McEcsOptions, opts: any) {
        super("awsmc:ecs:" + name, name, args, opts);
        this.name = name;
        this.azName = aws.getAvailabilityZones({}).then(zones => zones.names[0]);

        let defaultOptions: McEcsOptions = {
          image: "itzg/minecraft-server",
          cpu: 256,
          memory: 512,
          useSpotInstance: false,
          serverProperties: {
            MODT: "Welcome to Minecraft",
            DIFFICULTY: "normal",
            GAME_MODE: "survival",
            ONLINE_MODE: "true",
            SERVER_NAME: "Minecraft Server",
          }
        };

        this.mcEcsOptions = Object.assign(defaultOptions, args);

        this.efs = new aws.efs.FileSystem("efs", {
          encrypted: true,
          availabilityZoneName: this.azName, // Only one AZ because it's cheaper
          performanceMode: "generalPurpose",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.efsBackupPolicy =  new aws.efs.BackupPolicy("efs-backup-policy", {
          fileSystemId: this.efs.id,
          backupPolicy: {
            status: "ENABLED"
          }
        }, {parent: this});

        this.accessPoint = new aws.efs.AccessPoint("efs-ap", {
          fileSystemId: this.efs.id,
          posixUser: {
            gid: 1000,
            uid: 1000,
          },
          rootDirectory: {
            creationInfo: {
              ownerGid: 1000,
              ownerUid: 1000,
              permissions: "777",
            },
            path: "/minecraft",
          },
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.taskRole = new aws.iam.Role("taskrole", {
          assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Action: "sts:AssumeRole",
                Principal: {
                  Service: "ecs-tasks.amazonaws.com",
                },
                Effect: "Allow",
                Sid: "",
              },
            ],
          }),
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
          description: "Role for ECS task running mincecraft server",
          namePrefix: "mc-taskrole",
          inlinePolicies: [{
            name: "mc-taskrole-efs",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Action: [
                    "elasticfilesystem:ClientMount",
                    "elasticfilesystem:ClientWrite",
                    "elasticfilesystem:DescribeFileSystems",
                    "elasticfilesystem:backup",
                    "elasticfilesystem:restore",

                  ],
                  Effect: "Allow",
                  Resource: this.efs.arn,
                  Condition: {
                    "StringEquals": {
                      "elasticfilesystem:AccessPointArn": this.accessPoint.arn
                    }
                  }
                }
              ]
            })
          },
          {
            name: "mc-taskrole-cloudwatch",
            policy: pulumi.jsonStringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                  ],
                  Effect: "Allow",
                  Resource: pulumi.interpolate `arn:aws:logs:*:*:log-group:${this.name}:*`,
                }
              ]
            })
          }]
        }, {parent: this});


        this.taskDefinition = new aws.ecs.TaskDefinition("taskdefinition", {
          family: name,
          taskRoleArn: this.taskRole.arn,
          executionRoleArn: this.taskRole.arn,
          containerDefinitions: JSON.stringify([
            {
              name: name,
              image: this.mcEcsOptions.image,
              memory: this.mcEcsOptions.memory,
              portMappings: [
                {
                  containerPort: 25565,
                  hostPort: 25565,
                  protocol: "tcp",
                },
              ],
              logConfiguration: {
                logDriver: "awslogs",
                options: {
                    "awslogs-create-group": "true",
                    "awslogs-group": name,
                    "awslogs-region": "eu-central-1",
                    "awslogs-stream-prefix": name
                }
            },
              mountPoints: [
                {
                  containerPath: "/data",
                  sourceVolume: "minecraft",
                },
              ],
              environment: [
                {
                  name: "EULA",
                  value: "TRUE",
                },
                {
                  name: "MEMORY",
                  value: `${this.mcEcsOptions.memory}M`
                },
                ...this.buildEnvVars()],
              essential: true,

            },
          ]),
          requiresCompatibilities: ["FARGATE"],
          cpu: `${this.mcEcsOptions.cpu}`,
          memory: `${this.mcEcsOptions.memory}`,
          networkMode: "awsvpc",
          runtimePlatform: {
            operatingSystemFamily: "LINUX",
            cpuArchitecture: this.mcEcsOptions.useSpotInstance ? "X86_64": "ARM64", // Graviton is cheaper but only available for non-spot instances
          },
          volumes: [{
            name: "minecraft",
            efsVolumeConfiguration: {
              fileSystemId: this.efs.id,
              transitEncryption: "ENABLED",
              authorizationConfig: {
                accessPointId: this.accessPoint.id,
                iam: "ENABLED",
              },
            },

          }],
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this, dependsOn: [this.accessPoint, this.efs, this.taskRole]});

        this.cluster = new aws.ecs.Cluster("cluster", {
          name: name,
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});

        this.securityGroup = new aws.ec2.SecurityGroup("securitygroup", {
          description: "Allow inbound port 25565, outbound all",
          namePrefix: "mc-ecs-sg",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this});


        const securityGroupIngressRules = [{
          securityGroupId: this.securityGroup.id,
          ipProtocol: "tcp",
          fromPort: 25565,
          toPort: 25565,
          cidrIpv4: "0.0.0.0/0",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        },
        {
          securityGroupId: this.securityGroup.id,
        ipProtocol: "tcp",
        fromPort: 2049,
        toPort: 2049,
        cidrIpv4: aws.ec2.getVpc({}).then(vpc => vpc.cidrBlock),
        tags: {
          "pulumi-name": name,
          "created-by": "pulumi",
          "service": "awsmc"
        }}];

        this.securityGroupIngressRules = securityGroupIngressRules.map((rule, index) => {
          return new aws.vpc.SecurityGroupIngressRule(`securitygroupingressrule-${index}`, rule, {parent: this, dependsOn: [this.securityGroup]});
        });


        this.securityGroupEgressRule = new aws.vpc.SecurityGroupEgressRule("securitygroupegressrule", {
          securityGroupId: this.securityGroup.id,
          ipProtocol: "-1",
          cidrIpv4: "0.0.0.0/0",
          tags: {
            "pulumi-name": name,
            "created-by": "pulumi",
            "service": "awsmc"
          }
        },{parent: this, dependsOn: [this.securityGroup]});
      }

      buildEnvVars() {
      let envVars = [];
      for (const [key, value] of Object.entries(this.mcEcsOptions.serverProperties)) {
        envVars.push({
          name: key,
          value: value,
        });
      }
      return envVars;
    }
      async deploy() {
        const subnetIds = await this.getSubnetIds();

        this.mountTarget = new aws.efs.MountTarget("mounttarget", {
          fileSystemId: this.efs.id,
          subnetId: subnetIds[0],
          securityGroups: [this.securityGroup.id],
        }, {parent: this, deleteBeforeReplace: true});

        const capacityProvider = this.mcEcsOptions.useSpotInstance ? {
          capacityProvider: "FARGATE_SPOT",
          weight: 1,
          base: 0,
        } : {
          capacityProvider: "FARGATE",
          weight: 1,
          base: 1,
        };

        this.service = new aws.ecs.Service(this.name, {
          cluster: this.cluster.arn,
          desiredCount: 1,
          // launchType: "FARGATE", not allowed because we set capacityProviderStrategies
          taskDefinition: this.taskDefinition.arn,
          capacityProviderStrategies: [capacityProvider],
          networkConfiguration: {
            subnets: subnetIds,
            assignPublicIp: true,
            securityGroups: [this.securityGroup.id],
          },
          tags: {
            "pulumi-name": this.name,
            "created-by": "pulumi",
            "service": "awsmc"
          },
        }, {parent: this,  dependsOn: [this.securityGroupEgressRule, this.mountTarget, this.taskRole, this.cluster, this.taskDefinition] });




    }

      async getSubnetIds(){
        return await aws.ec2.getSubnets({
          filters: [
            {
              name: "availability-zone",
              values: [await this.azName]
            },
          ]
        }, { async: true }).then((subnets) => subnets.ids);
      }
    }

export { McEcs, McEcsOptions };