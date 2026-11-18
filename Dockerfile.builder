FROM python:3.12-slim
WORKDIR /work
COPY build_graph.py .
CMD ["python", "-I", "build_graph.py"]
