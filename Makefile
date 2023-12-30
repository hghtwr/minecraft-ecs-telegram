build::
	zip -j ./telegram/handler/commands.zip ./telegram/handler/commands.py
	zip -j ./telegram/handler/ready.zip ./telegram/handler/ready.py
	zip -j ./telegram/handler/stopped.zip ./telegram/handler/stopped.py
	(cd ./telegram/handler/layer/ && zip -r ./dependencies.zip ./python)

