FROM python:3.12-slim
RUN pip install --no-cache-dir neo4j==5.26.0
WORKDIR /app
COPY load_graph.py .
CMD ["python", "-u", "load_graph.py"]
